import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MoneyText } from "@/components/money-text";
import { useT } from "@/components/use-t";
import { actionKey, clearActionKey } from "@/lib/idempotency-client";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { REJECT_REASONS, type OrderState } from "@/lib/orders/state-machine";
import { advanceSimulatedRider } from "@/lib/server/api-orders";
import { transitionOrderViaHDmaster } from "@/lib/server/hdmaster-order-transition";

export type OrderView = {
  id: string;
  orderNumber: string;
  state: string;
  placedAt: string;
  customerArea: string | null;
  paymentMethod: string;
  isCod: boolean;
  specialInstructions: string | null;
  prepMinutes: number;
  dataLabel: string;
  prices: {
    foodValuePaise: number;
    packingPaise: number;
    restaurantDiscountPaise: number;
    platformFundedDiscountPaise: number;
    customerTotalPaise: number;
    restaurantPayablePaise: number;
    commissionPaise: number;
  };
  lines: {
    itemName: string;
    variantName: string | null;
    quantity: number;
    unitPricePaise: number;
    addons?: { name: string; pricePaise: number }[];
    specialInstructions?: string | null;
  }[];
};

const STATE_MARK: Record<string, { letter: string; cls: string }> = {
  PLACED: { letter: "N", cls: "bg-danger text-surface" },
  ACCEPTED: { letter: "A", cls: "bg-info text-surface" },
  PREPARING: { letter: "P", cls: "bg-warn text-surface" },
  READY: { letter: "R", cls: "bg-leaf text-surface" },
  RIDER_ASSIGNED: { letter: "K", cls: "bg-leaf text-surface" },
  PICKED_UP: { letter: "U", cls: "bg-leaf text-surface" },
  ON_THE_WAY: { letter: "W", cls: "bg-leaf text-surface" },
  DELIVERED: { letter: "D", cls: "bg-ink text-surface" },
  REJECTED: { letter: "X", cls: "bg-muted text-surface" },
  CANCELLED: { letter: "C", cls: "bg-muted text-surface" },
};

export function OrderCard({
  order,
  restaurantId,
  large,
  dataLabel,
  onChanged,
}: {
  order: OrderView;
  restaurantId?: string;
  large?: boolean;
  dataLabel?: string;
  onChanged?: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REJECT_REASONS)[number]>("item_unavailable");
  const [error, setError] = useState<string | null>(null);

  async function act(action: "accept" | "reject" | "preparing" | "ready") {
    setBusy(true);
    setError(null);
    try {
      await transitionOrderViaHDmaster({
        data: {
          restaurantId,
          orderId: order.id,
          action,
          reason: action === "reject" ? reason : undefined,
          idempotencyKey: actionKey(order.id, action),
        },
      });
      clearActionKey(order.id, action);
      setRejectOpen(false);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update order");
    } finally {
      setBusy(false);
    }
  }

  async function simRider() {
    setBusy(true);
    setError(null);
    try {
      await advanceSimulatedRider({
        data: {
          restaurantId,
          orderId: order.id,
          idempotencyKey: actionKey(order.id, "sim_rider"),
        },
      });
      clearActionKey(order.id, "sim_rider");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not advance rider");
    } finally {
      setBusy(false);
    }
  }

  const mark = STATE_MARK[order.state] ?? { letter: "•", cls: "bg-muted text-surface" };
  const received = new Date(order.placedAt);
  const mins = Math.max(0, Math.round((Date.now() - received.getTime()) / 60000));

  return (
    <Card className={cn("space-y-3", large && "p-5")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cn("grid size-10 place-items-center rounded-full text-sm font-semibold", mark.cls)} aria-label={order.state}>
            {mark.letter}
          </span>
          <div>
            <div className="font-semibold">{order.orderNumber}</div>
            <div className="text-xs text-muted">
              {t("orders.received")} {mins} {t("common.minutes")} · {order.customerArea ?? "Area hidden"}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-muted">{t(`status.${order.state}`)}</div>
          <MoneyText paise={order.prices.customerTotalPaise} className="text-lg font-semibold" />
        </div>
      </div>

      <ul className="space-y-1 text-sm">
        {order.lines.map((line, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>
              <span className="tabular font-medium">{line.quantity}×</span> {line.itemName}
              {line.variantName ? ` · ${line.variantName}` : ""}
              {line.addons?.length ? ` + ${line.addons.map((a) => a.name).join(", ")}` : ""}
            </span>
            <span className="tabular text-muted">{formatINR(line.unitPricePaise * line.quantity)}</span>
          </li>
        ))}
      </ul>

      {order.specialInstructions ? (
        <p className="rounded-[12px] bg-warn-soft px-3 py-2 text-sm text-warn">
          {t("orders.special")}: {order.specialInstructions}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 text-xs text-muted">
        <span className="rounded-full border border-line px-2 py-1">{order.isCod ? t("orders.cod") : t("orders.paid")}</span>
        <span className="rounded-full border border-line px-2 py-1">
          {t("orders.prepTime")} {order.prepMinutes} {t("common.minutes")}
        </span>
        {order.prices.restaurantDiscountPaise > 0 ? (
          <span className="rounded-full bg-chili-soft px-2 py-1 text-chili-dark">
            {t("orders.restaurantPromo")} {formatINR(order.prices.restaurantDiscountPaise)}
          </span>
        ) : null}
        {order.prices.platformFundedDiscountPaise > 0 ? (
          <span className="rounded-full bg-leaf-soft px-2 py-1 text-leaf">
            {t("orders.platformPromo")} {formatINR(order.prices.platformFundedDiscountPaise)}
          </span>
        ) : null}
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {rejectOpen ? (
        <div className="space-y-2 rounded-[16px] bg-surface-2 p-3">
          <p className="text-sm font-medium">{t("orders.rejectTitle")}</p>
          <p className="text-xs text-muted">{t("orders.rejectHint")}</p>
          <div className="grid gap-2">
            {REJECT_REASONS.map((r) => (
              <label key={r} className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" name={`reject-${order.id}`} checked={reason === r} onChange={() => setReason(r)} />
                {t(`rejectReasons.${r}`)}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="danger" disabled={busy} onClick={() => void act("reject")}>{t("orders.reject")}</Button>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>{t("common.cancel")}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {order.state === "PLACED" ? (
            <>
              <Button size={large ? "lg" : "md"} disabled={busy} onClick={() => void act("accept")}>{t("orders.accept")}</Button>
              <Button size={large ? "lg" : "md"} variant="secondary" disabled={busy} onClick={() => setRejectOpen(true)}>{t("orders.reject")}</Button>
            </>
          ) : null}
          {order.state === "ACCEPTED" ? (
            <Button size={large ? "lg" : "md"} disabled={busy} onClick={() => void act("preparing")}>{t("orders.preparing")}</Button>
          ) : null}
          {order.state === "PREPARING" ? (
            <Button size={large ? "lg" : "md"} variant="leaf" disabled={busy} onClick={() => void act("ready")}>{t("orders.ready")}</Button>
          ) : null}
          {dataLabel === "SIMULATED" && ["READY", "RIDER_ASSIGNED", "PICKED_UP", "ON_THE_WAY"].includes(order.state) ? (
            <Button size={large ? "lg" : "md"} variant="secondary" disabled={busy} onClick={() => void simRider()}>
              {t("orders.simulateRider")}
            </Button>
          ) : null}
        </div>
      )}
    </Card>
  );
}

export function isLiveState(state: OrderState | string): boolean {
  return !["DELIVERED", "REJECTED", "CANCELLED", "REFUNDED", "FAILED_PAYMENT", "PARTIAL_REFUND", "DELIVERY_FAILED"].includes(state);
}
