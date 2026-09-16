import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId, asInt, asIso } from "@/lib/utils";
import { assertTransition, isOrderState, SIMULATED_RIDER_NEXT, type OrderState } from "@/lib/orders/state-machine";
import { withVendor, writeAudit, notifyInApp } from "./helpers";
import { isOpenAt, minutesUntilClose, type Shift, type Weekday } from "@/lib/hours";

type OrderRow = { id: string; order_number: string; restaurant_id: string; outlet_id: string; state: string; placed_at: string; customer_area: string | null; payment_method: string; is_cod: boolean; special_instructions: string | null; prep_minutes: number; food_value_paise: number; packing_paise: number; restaurant_discount_paise: number; platform_funded_discount_paise: number; tax_paise: number; platform_fee_paise: number; commission_bps: number; commission_paise: number; other_deductions_paise: number; other_deductions_code: string | null; refund_adjustment_paise: number; restaurant_payable_paise: number; customer_total_paise: number; data_label: string; reject_reason: string | null };
type OrderLineView = { id: string; itemName: string; variantName: string | null; quantity: number; unitPricePaise: number; lineTotalPaise: number; specialInstructions: string | null; addons: { name: string; pricePaise: number }[] };
type OrderEventView = { id: string; previousState: string | null; newState: string; actor: string; reason: string | null; at: string };

function mapOrder(row: OrderRow, lines: OrderLineView[], events: OrderEventView[]) {
  return { id: row.id, orderNumber: row.order_number, restaurantId: row.restaurant_id, outletId: row.outlet_id, state: row.state, placedAt: asIso(row.placed_at), customerArea: row.customer_area, paymentMethod: row.payment_method, isCod: row.is_cod === true || (row.is_cod as unknown) === "t", specialInstructions: row.special_instructions, prepMinutes: asInt(row.prep_minutes), rejectReason: row.reject_reason, dataLabel: row.data_label, prices: { foodValuePaise: asInt(row.food_value_paise), packingPaise: asInt(row.packing_paise), restaurantDiscountPaise: asInt(row.restaurant_discount_paise), platformFundedDiscountPaise: asInt(row.platform_funded_discount_paise), taxPaise: asInt(row.tax_paise), platformFeePaise: asInt(row.platform_fee_paise), commissionBps: asInt(row.commission_bps), commissionPaise: asInt(row.commission_paise), otherDeductionsPaise: asInt(row.other_deductions_paise), otherDeductionsCode: row.other_deductions_code, refundAdjustmentPaise: asInt(row.refund_adjustment_paise), restaurantPayablePaise: asInt(row.restaurant_payable_paise), customerTotalPaise: asInt(row.customer_total_paise) }, lines, events };
}

export const listOrders = createServerFn({ method: "GET" }).middleware([authMiddleware]).validator((d: { restaurantId?: string; scope?: "live" | "history" | "all" }) => d).handler(async ({ context, data }) => {
  return withVendor(context.userId, data.restaurantId, "orders.view", async (sql, ctx) => {
    const scope = data.scope ?? "live";
    const rows = await sql<OrderRow>`select * from orders where restaurant_id = ${ctx.restaurantId} and (${scope} = 'all' or (${scope} = 'live' and state not in ('DELIVERED','REJECTED','CANCELLED','REFUNDED','FAILED_PAYMENT')) or (${scope} = 'history' and state in ('DELIVERED','REJECTED','CANCELLED','REFUNDED','FAILED_PAYMENT','DELIVERY_FAILED','PARTIAL_REFUND'))) order by placed_at desc limit 80`;
    const ids = rows.map((r) => r.id);
    const lines = ids.length === 0 ? [] : await sql.query<{ id: string; order_id: string; item_name: string; variant_name: string | null; quantity: number; unit_price_paise: number; line_total_paise: number; special_instructions: string | null }>(`select id, order_id, item_name, variant_name, quantity, unit_price_paise, line_total_paise, special_instructions from order_items where restaurant_id = $1 and order_id in (${ids.map((_, i) => `$${i + 2}`).join(",")})`, [ctx.restaurantId, ...ids]);
    const addons = lines.length === 0 ? [] : await sql.query<{ order_item_id: string; name: string; price_paise: number }>(`select order_item_id, name, price_paise from order_item_addons where order_item_id in (${lines.map((_, i) => `$${i + 1}`).join(",")})`, lines.map((l) => l.id));
    const events = ids.length === 0 ? [] : await sql.query<{ id: string; order_id: string; previous_state: string | null; new_state: string; actor: string; reason: string | null; at: string }>(`select id, order_id, previous_state, new_state, actor, reason, at::text as at from order_events where restaurant_id = $1 and order_id in (${ids.map((_, i) => `$${i + 2}`).join(",")}) order by at asc`, [ctx.restaurantId, ...ids]);
    const linesByOrder = new Map<string, OrderLineView[]>();
    for (const line of lines) { const list = linesByOrder.get(line.order_id) ?? []; list.push({ id: line.id, itemName: line.item_name, variantName: line.variant_name, quantity: asInt(line.quantity), unitPricePaise: asInt(line.unit_price_paise), lineTotalPaise: asInt(line.line_total_paise), specialInstructions: line.special_instructions, addons: addons.filter((a) => a.order_item_id === line.id).map((a) => ({ name: a.name, pricePaise: asInt(a.price_paise) })) }); linesByOrder.set(line.order_id, list); }
    const eventsByOrder = new Map<string, OrderEventView[]>();
    for (const ev of events) { const list = eventsByOrder.get(ev.order_id) ?? []; list.push({ id: ev.id, previousState: ev.previous_state, newState: ev.new_state, actor: ev.actor, reason: ev.reason, at: asIso(ev.at) }); eventsByOrder.set(ev.order_id, list); }
    return { restaurantId: ctx.restaurantId, dataLabel: ctx.dataLabel, role: ctx.role, serverTime: new Date().toISOString(), orders: rows.map((r) => mapOrder(r, linesByOrder.get(r.id) ?? [], eventsByOrder.get(r.id) ?? [])) };
  });
});

export const advanceSimulatedRider = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d: { restaurantId?: string; orderId: string; idempotencyKey: string }) => d).handler(async ({ context, data }) => {
  return withVendor(context.userId, data.restaurantId, "orders.view", async (sql, ctx) => {
    if (ctx.dataLabel !== "SIMULATED") throw new Error("Rider simulation is only available on labelled SIMULATED kitchens.");
    const prior = await sql<{ response_json: string }>`select response_json from idempotency_keys where restaurant_id = ${ctx.restaurantId} and action = 'sim_rider' and key = ${data.idempotencyKey} limit 1`;
    if (prior[0]) return JSON.parse(prior[0].response_json);
    const rows = await sql<{ id: string; state: string }>`select id, state from orders where id = ${data.orderId} and restaurant_id = ${ctx.restaurantId}`;
    const order = rows[0];
    if (!order || !isOrderState(order.state)) throw new Error("Order not found");
    const next = SIMULATED_RIDER_NEXT[order.state];
    if (!next) throw new Error("No simulated rider step from this state");
    const previous = order.state as OrderState;
    assertTransition(previous, next, "simulated_rider");
    await sql`update orders set state = ${next}, delivered_at = case when ${next} = 'DELIVERED' then now() else delivered_at end where id = ${order.id} and restaurant_id = ${ctx.restaurantId}`;
    await sql`insert into order_events (id, order_id, restaurant_id, previous_state, new_state, actor, actor_user_id, reason) values (${newId("evt")}, ${order.id}, ${ctx.restaurantId}, ${previous}, ${next}, 'simulated_rider', ${context.userId}, 'SIMULATED')`;
    const result = { ok: true as const, state: next, simulated: true as const };
    await sql`insert into idempotency_keys (key, restaurant_id, action, response_json) values (${data.idempotencyKey}, ${ctx.restaurantId}, 'sim_rider', ${JSON.stringify(result)})`;
    return result;
  });
});

export const getDashboard = createServerFn({ method: "GET" }).middleware([authMiddleware]).validator((d: { restaurantId?: string }) => d).handler(async ({ context, data }) => {
  return withVendor(context.userId, data.restaurantId, "dashboard.view", async (sql, ctx) => {
    const stats = await sql<{ orders: number; sales: number; accepted: number; pending: number; cancelled: number; refunds: number; payable: number; aov: number }>`select count(*)::int as orders, coalesce(sum(customer_total_paise) filter (where state not in ('REJECTED','CANCELLED','FAILED_PAYMENT')), 0)::int as sales, count(*) filter (where state in ('ACCEPTED','PREPARING','READY','RIDER_ASSIGNED','PICKED_UP','ON_THE_WAY','DELIVERED'))::int as accepted, count(*) filter (where state = 'PLACED')::int as pending, count(*) filter (where state = 'CANCELLED')::int as cancelled, coalesce(sum(refund_adjustment_paise), 0)::int as refunds, coalesce(sum(restaurant_payable_paise) filter (where state = 'DELIVERED'), 0)::int as payable, coalesce(avg(customer_total_paise) filter (where state = 'DELIVERED'), 0)::int as aov from orders where restaurant_id = ${ctx.restaurantId} and placed_at >= date_trunc('day', now())`;
    const unavailable = await sql<{ c: number }>`select count(*)::int as c from item_availability a join items i on i.id = a.item_id where a.restaurant_id = ${ctx.restaurantId} and a.status <> 'available' and i.is_active = true`;
    const rating = await sql<{ avg: number | null; n: number }>`select avg(rating)::float as avg, count(*)::int as n from reviews where restaurant_id = ${ctx.restaurantId}`;
    const delayed = await sql<{ c: number }>`select count(*)::int as c from orders where restaurant_id = ${ctx.restaurantId} and state in ('ACCEPTED','PREPARING') and placed_at < now() - (prep_minutes || ' minutes')::interval`;
    const hours = await sql<{ weekday: number; open_minutes: number; close_minutes: number }>`select weekday, open_minutes, close_minutes from restaurant_hours where restaurant_id = ${ctx.restaurantId}`;
    const rest = await sql<{ emergency_closed: boolean; vacation_mode: boolean; admin_hours_override: boolean; weekly_holidays: string; verification_status: string; fssai_number: string }>`select emergency_closed, vacation_mode, admin_hours_override, weekly_holidays, verification_status, fssai_number from restaurants where id = ${ctx.restaurantId}`;
    const r = rest[0]; const shifts: Shift[] = hours.map((h) => ({ weekday: h.weekday as Weekday, openMinutes: h.open_minutes, closeMinutes: h.close_minutes }));
    const holidays = (r?.weekly_holidays ?? "").split(",").map((x) => Number(x.trim())).filter((n) => n >= 0 && n <= 6) as Weekday[];
    const nowIso = new Date().toISOString(); const open = r ? isOpenAt({ nowIso, shifts, closures: [], weeklyHolidays: holidays, emergencyClosed: r.emergency_closed === true || (r.emergency_closed as unknown) === "t", adminOverride: r.admin_hours_override === true }) : false; const untilClose = minutesUntilClose({ nowIso, shifts }); const s = stats[0];
    const attention: { id: string; key: string; tone: "warn" | "info" | "danger"; n?: number; status?: string }[] = [];
    if (asInt(s?.pending) > 0) attention.push({ id: "pending", key: "dashboard.attnPending", n: asInt(s?.pending), tone: "danger" });
    if (asInt(unavailable[0]?.c) > 0) attention.push({ id: "unavail", key: "dashboard.attnUnavailable", n: asInt(unavailable[0]?.c), tone: "warn" });
    if (open && untilClose != null && untilClose <= 30) attention.push({ id: "close", key: "dashboard.attnClosing", n: untilClose, tone: "warn" });
    if (r && r.verification_status !== "VERIFIED") attention.push({ id: "verify", key: "dashboard.attnVerify", status: r.verification_status, tone: "info" });
    if (r && !r.fssai_number) attention.push({ id: "fssai", key: "dashboard.attnFssai", tone: "warn" });
    if (asInt(delayed[0]?.c) > 0) attention.push({ id: "delay", key: "dashboard.attnDelay", n: asInt(delayed[0]?.c), tone: "danger" });
    const pendingSettle = await sql<{ c: number; amt: number }>`select count(*)::int as c, coalesce(sum(total_payable_paise),0)::int as amt from settlement_batches where restaurant_id = ${ctx.restaurantId} and status = 'pending'`;
    if (asInt(pendingSettle[0]?.c) > 0) attention.push({ id: "settle", key: "dashboard.attnSettle", tone: "info" });
    const deliveredCustomers = await sql<{ c: number; repeats: number }>`select count(distinct customer_ref)::int as c, count(distinct customer_ref) filter (where cnt > 1)::int as repeats from (select customer_ref, count(*) as cnt from orders where restaurant_id = ${ctx.restaurantId} and state = 'DELIVERED' and customer_ref is not null group by customer_ref) t`;
    const cust = deliveredCustomers[0]; const repeatPct = asInt(cust?.c) > 0 ? Math.round((asInt(cust?.repeats) * 100) / asInt(cust?.c)) : null;
    return { dataLabel: ctx.dataLabel, restaurantName: ctx.restaurantName, role: ctx.role, verificationStatus: ctx.verificationStatus, isOpen: open, serverTime: nowIso, today: { orders: asInt(s?.orders), salesPaise: asInt(s?.sales), aovPaise: asInt(s?.aov), accepted: asInt(s?.accepted), pending: asInt(s?.pending), cancelled: asInt(s?.cancelled), refundsPaise: asInt(s?.refunds), settlementPaise: asInt(s?.payable), unavailableItems: asInt(unavailable[0]?.c), rating: rating[0]?.avg != null ? Math.round(Number(rating[0].avg) * 10) / 10 : null, ratingCount: asInt(rating[0]?.n), repeatPct }, attention };
  });
});

export const getOperatingSnapshot = createServerFn({ method: "GET" }).middleware([authMiddleware]).validator((d: { restaurantId?: string }) => d).handler(async ({ context, data }) => {
  return withVendor(context.userId, data.restaurantId, "hours.edit", async (sql, ctx) => {
    const hours = await sql<{ id: string; weekday: number; open_minutes: number; close_minutes: number }>`select id, weekday, open_minutes, close_minutes from restaurant_hours where restaurant_id = ${ctx.restaurantId} order by weekday, open_minutes`;
    const rest = await sql<{ emergency_closed: boolean; vacation_mode: boolean; weekly_holidays: string; prep_minutes: number; peak_prep_minutes: number }>`select emergency_closed, vacation_mode, weekly_holidays, prep_minutes, peak_prep_minutes from restaurants where id = ${ctx.restaurantId}`;
    return { hours, restaurant: rest[0], dataLabel: ctx.dataLabel };
  });
});

export const saveHours = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d: { restaurantId?: string; emergencyClosed?: boolean; vacationMode?: boolean; weeklyHolidays?: string; prepMinutes?: number; peakPrepMinutes?: number; shifts: { weekday: number; openMinutes: number; closeMinutes: number }[] }) => d).handler(async ({ context, data }) => {
  return withVendor(context.userId, data.restaurantId, "hours.edit", async (sql, ctx) => {
    await sql`delete from restaurant_hours where restaurant_id = ${ctx.restaurantId}`;
    for (const s of data.shifts) { if (s.weekday < 0 || s.weekday > 6) continue; await sql`insert into restaurant_hours (id, restaurant_id, weekday, open_minutes, close_minutes) values (${newId("hrs")}, ${ctx.restaurantId}, ${s.weekday}, ${s.openMinutes}, ${s.closeMinutes})`; }
    await sql`update restaurants set emergency_closed = ${Boolean(data.emergencyClosed)}, vacation_mode = ${Boolean(data.vacationMode)}, weekly_holidays = ${data.weeklyHolidays ?? ""}, prep_minutes = ${asInt(data.prepMinutes, 20)}, peak_prep_minutes = ${asInt(data.peakPrepMinutes, 30)}, updated_at = now() where id = ${ctx.restaurantId}`;
    return { ok: true as const };
  });
});
