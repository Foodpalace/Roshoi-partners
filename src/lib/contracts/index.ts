/**
 * Integration contracts for the Order King platform.
 * Window 1 (customer), Window 3 (rider), Window 4 (admin), Window 5 (core)
 * should consume these shapes. Adapters live in `@/lib/adapters`.
 */

import type { DataLabel } from "@/lib/platform-config";
import type { OrderState, RejectReason, TransitionActor } from "@/lib/orders/state-machine";
import type { Paise } from "@/lib/money";
import type { RestaurantRole } from "@/lib/rbac";

export const API_VERSION = "v1";

export type VerificationStatus = "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED";
export type DietFlag = "VEG" | "NONVEG" | "EGG" | "VEGAN";
export type AvailabilityStatus = "available" | "sold_out" | "temporarily_unavailable" | "scheduled";
export type PromotionFunder = "RESTAURANT" | "PLATFORM";
export type PromotionKind = "percent" | "fixed" | "item" | "bogo";
export type PaymentMethod = "COD" | "UPI" | "CARD" | "NETBANKING" | "WALLET" | "UNKNOWN";

export type CatalogRestaurant = { id: string; displayName: string; cuisine: string[]; diet: DietFlag; rating: number | null; ratingCount: number; etaMinutes: number | null; isOpen: boolean; logoUrl: string | null; coverUrl: string | null; area: string | null; dataLabel: DataLabel; verificationStatus: VerificationStatus };
export type CatalogItem = { id: string; categoryId: string; categoryName: string; name: string; description: string; imageUrl: string | null; diet: DietFlag; tags: string[]; recommended: boolean; availability: AvailabilityStatus; prepMinutes: number | null; variants: { id: string; name: string; pricePaise: Paise }[]; addons: { id: string; name: string; pricePaise: Paise }[] };
export type OrderSnapshotLine = { itemId: string; itemName: string; variantId: string | null; variantName: string | null; quantity: number; unitPricePaise: Paise; addons: { addonId: string; name: string; pricePaise: Paise }[]; specialInstructions: string | null };
export type OrderPriceSnapshot = { foodValuePaise: Paise; packingPaise: Paise; restaurantDiscountPaise: Paise; platformFundedDiscountPaise: Paise; taxPaise: Paise; platformFeePaise: Paise; commissionBps: number; commissionPaise: Paise; otherDeductionsPaise: Paise; otherDeductionsCode: string | null; refundAdjustmentPaise: Paise; restaurantPayablePaise: Paise; customerTotalPaise: Paise };
export type OrderEvent = { id: string; orderId: string; previousState: OrderState | null; newState: OrderState; actor: TransitionActor; actorUserId: string | null; reason: string | null; at: string };
export type VendorOrder = { id: string; orderNumber: string; restaurantId: string; outletId: string; state: OrderState; placedAt: string; customerArea: string | null; paymentMethod: PaymentMethod; isCod: boolean; specialInstructions: string | null; prepMinutes: number; lines: OrderSnapshotLine[]; prices: OrderPriceSnapshot; dataLabel: DataLabel; riderStatus: OrderState | null };
export type RiderDispatchTicket = { orderId: string; orderNumber: string; restaurantId: string; pickup: { lat: number | null; lng: number | null; address: string; instructions: string | null }; readyAt: string; orderCode: string; dataLabel: DataLabel };
export type StaffMembership = { restaurantId: string; outletId: string | null; role: RestaurantRole };
export type AdminRestaurantAction =
  | { type: "verify"; restaurantId: string }
  | { type: "reject"; restaurantId: string; reason: string }
  | { type: "suspend"; restaurantId: string; reason: string }
  | { type: "set_commission"; restaurantId: string; bps: number }
  | { type: "override_hours"; restaurantId: string; open: boolean };
export type NotificationChannel = "in_app" | "push" | "sms" | "whatsapp";
export type NotificationPayload = { restaurantId: string; type: string; title: string; body: string; channels: NotificationChannel[]; data?: Record<string, string> };
