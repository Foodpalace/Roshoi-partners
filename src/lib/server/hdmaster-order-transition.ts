import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "@/lib/utils";
import { isOrderState, isRejectReason, type OrderState } from "@/lib/orders/state-machine";
import { withVendor, writeAudit, notifyInApp } from "./helpers";

const CONTRACT_VERSION = "1" as const;

type Action = "accept" | "reject" | "preparing" | "ready";
type CanonicalStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PREPARING"
  | "READY"
  | "RESTAURANT_REJECTED";

function coreUrl(): string {
  const value = process.env.HDMASTER_URL?.trim();
  if (!value) throw new Error("HDMASTER_URL is not configured");
  return value.replace(/\/+$/, "");
}

function serviceToken(): string {
  const value = process.env.ROSHOI_SERVICE_TOKEN?.trim();
  if (!value) throw new Error("ROSHOI_SERVICE_TOKEN is not configured");
  return value;
}

function canonicalFrom(state: OrderState): CanonicalStatus {
  switch (state) {
    case "PLACED": return "PENDING";
    case "ACCEPTED": return "CONFIRMED";
    case "PREPARING": return "PREPARING";
    case "READY": return "READY";
    default: throw new Error(`Order state ${state} cannot be transitioned by a restaurant`);
  }
}

function canonicalTo(action: Action): CanonicalStatus {
  switch (action) {
    case "accept": return "CONFIRMED";
    case "reject": return "RESTAURANT_REJECTED";
    case "preparing": return "PREPARING";
    case "ready": return "READY";
  }
}

function localToCanonicalState(state: string): CanonicalStatus {
  if (!isOrderState(state)) throw new Error("Corrupt order state");
  return canonicalFrom(state);
}

function localStateFor(action: Action): OrderState {
  return action === "accept" ? "ACCEPTED" : action === "reject" ? "REJECTED" : action === "preparing" ? "PREPARING" : "READY";
}

export const transitionOrderViaHDmaster = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: {
    restaurantId?: string;
    orderId: string;
    action: Action;
    reason?: string;
    idempotencyKey: string;
  }) => d)
  .handler(async ({ context, data }) => {
    const perm = data.action === "accept" ? "orders.accept" : data.action === "reject" ? "orders.reject" : data.action === "preparing" ? "orders.prepare" : "orders.ready";
    return withVendor(context.userId, data.restaurantId, perm, async (sql, ctx) => {
      if (!data.idempotencyKey || data.idempotencyKey.length < 8) throw new Error("Idempotency key required");
      const prior = await sql<{ response_json: string }>`
        select response_json from idempotency_keys
        where restaurant_id = ${ctx.restaurantId} and action = ${`core_${data.action}`} and key = ${data.idempotencyKey}
        limit 1
      `;
      if (prior[0]) return JSON.parse(prior[0].response_json) as { ok: true; state: OrderState; duplicate: true; canonicalState: CanonicalStatus };

      const rows = await sql<{ id: string; state: string; data_label: string }>`
        select id, state, data_label from orders
        where id = ${data.orderId} and restaurant_id = ${ctx.restaurantId}
        limit 1
      `;
      const order = rows[0];
      if (!order || !isOrderState(order.state)) throw new Error("Order not found or has an invalid state");
      if (data.action === "reject" && (!data.reason || !isRejectReason(data.reason))) throw new Error("A valid reject reason is required");

      const from = localToCanonicalState(order.state);
      const to = canonicalTo(data.action);
      const response = await fetch(`${coreUrl()}/v1/admin/orders/${encodeURIComponent(order.id)}/transition`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${serviceToken()}`,
          "Idempotency-Key": data.idempotencyKey,
          "X-Correlation-Id": `partner:${ctx.restaurantId}:${order.id}:${data.action}`,
        },
        body: JSON.stringify({
          contractVersion: CONTRACT_VERSION,
          restaurantId: ctx.restaurantId,
          from,
          to,
          reason: data.reason,
          correlationId: `partner:${ctx.restaurantId}:${order.id}:${data.action}`,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { data?: { state?: CanonicalStatus; duplicate?: boolean }; error?: string };
      if (!response.ok || !payload.data?.state) {
        throw new Error(payload.error ?? `HDmaster order transition failed (${response.status})`);
      }

      const next = localStateFor(data.action);
      const updated = await sql`
        update orders set state = ${next},
          reject_reason = ${data.action === "reject" ? data.reason ?? null : null},
          accepted_at = case when ${next} = 'ACCEPTED' then now() else accepted_at end,
          ready_at = case when ${next} = 'READY' then now() else ready_at end
        where id = ${order.id} and restaurant_id = ${ctx.restaurantId} and state = ${order.state}
      `;
      if (updated.length !== 1) throw new Error("Local Partner projection changed concurrently; refresh and retry");

      await sql`
        insert into order_events (id, order_id, restaurant_id, previous_state, new_state, actor, actor_user_id, reason)
        values (${newId("evt")}, ${order.id}, ${ctx.restaurantId}, ${order.state}, ${next}, 'restaurant', ${context.userId}, ${data.reason ?? null})
      `;
      await writeAudit(sql, {
        restaurantId: ctx.restaurantId,
        actorUserId: context.userId,
        action: `order_${data.action}_via_hdmaster`,
        entityType: "order",
        entityId: order.id,
        detail: `${order.state}→${next}; canonical ${from}→${payload.data.state}`,
      });
      await notifyInApp(sql, { restaurantId: ctx.restaurantId, type: "order_status", title: next, body: `${order.state} → ${next}` });

      const result = {
        ok: true as const,
        state: next,
        canonicalState: payload.data.state,
        duplicate: Boolean(payload.data.duplicate),
        dispatchQueued: next === "READY",
        authoritative: "HDmaster" as const,
      };
      await sql`
        insert into idempotency_keys (key, restaurant_id, action, response_json)
        values (${data.idempotencyKey}, ${ctx.restaurantId}, ${`core_${data.action}`}, ${JSON.stringify(result)})
      `;
      return result;
    });
  });
