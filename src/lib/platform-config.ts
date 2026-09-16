/**
 * Central platform configuration for Order King.
 * Business identity, theme, fees, flags and legal copy live here — not in
 * scattered components. Window 4 may overlay these values via `platform_settings`.
 * Secrets never belong in this file.
 */

export const COMMISSION_OPTIONS_BPS = [0, 500, 800, 1000, 1200] as const;

export type FeatureFlagName =
  | "restaurant_ai"
  | "restaurant_analytics"
  | "promotions"
  | "advanced_inventory"
  | "multi_outlet"
  | "whatsapp_notifications"
  | "sms_notifications"
  | "pwa"
  | "offline_mode"
  | "new_order_sound";

export const platformConfig = {
  brand: {
    appName: "Order King Partner",
    shortAppName: "Order King",
    tagline: "Your kitchen. Your orders. Your settlement.",
    restaurantFacingBrandName: "Order King Partner",
    customerFacingBrand: "Order King",
    adminFacingBrand: "Order King Command",
    legalCompanyName: "Order King Foods Private Limited",
    domain: "orderking.in",
    notificationSenderName: "Order King",
    invoiceFooter: "Thank you for cooking with Order King.",
    logo: "/brand/logo.svg",
    darkLogo: "/brand/logo-dark.svg",
    lightLogo: "/brand/logo-light.svg",
    favicon: "/favicon.svg",
    appIcon: "/brand/app-icon.svg",
    restaurantFacingLogo: "/brand/logo.svg",
  },
  theme: {
    primary: "#B33A1B",
    secondary: "#2F5D50",
    accent: "#B33A1B",
    background: "#F4EFE6",
    surface: "#FFFDF8",
    text: "#1C1714",
    textMuted: "#6F645B",
    border: "#E4D8C8",
    danger: "#9B1D1D",
    warning: "#8A5A12",
    success: "#2F5D50",
    typography: {
      display: '"Fraunces", "Noto Serif Bengali", serif',
      body: '"Figtree", "Hind Siliguri", system-ui, sans-serif',
    },
  },
  localization: {
    defaultLanguage: "en" as const,
    supportedLanguages: ["en", "bn"] as const,
    futureLanguages: ["as"] as const,
  },
  restaurantSettings: {
    defaultPrepMinutes: 20,
    defaultPeakPrepMinutes: 30,
    defaultCommissionBps: 1000,
    orderPollMs: 4000,
    kitchenPollMs: 3000,
    maxUploadBytes: 512 * 1024,
    allowedDocumentTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    allowedImageTypes: ["image/jpeg", "image/png", "image/webp"],
  },
  fees: { currency: "INR", currencySymbol: "₹", moneyUnit: "paise", defaultPackingPaise: 0 },
  commission: { targetBps: 1000, allowedBps: COMMISSION_OPTIONS_BPS, allowCustom: true },
  notifications: { smsProvider: "NOT_CONNECTED", whatsappProvider: "NOT_CONNECTED", pushProvider: "NOT_CONNECTED", smsSender: "", whatsappSender: "" },
  legal: { gstInformation: "", fssaiInformation: "", supportPhone: "", supportEmail: "partners@orderking.in", socialLinks: { instagram: "", facebook: "", x: "" } },
  support: { phone: "", email: "partners@orderking.in", helpCenter: "" },
  featureFlags: {
    restaurant_ai: true,
    restaurant_analytics: true,
    promotions: true,
    advanced_inventory: false,
    multi_outlet: true,
    whatsapp_notifications: false,
    sms_notifications: false,
    pwa: true,
    offline_mode: true,
    new_order_sound: true,
  } satisfies Record<FeatureFlagName, boolean>,
  dataLabels: ["SIMULATED", "REAL", "VERIFIED"] as const,
} as const;

export type PlatformConfig = typeof platformConfig;
export type DataLabel = (typeof platformConfig.dataLabels)[number];
export type AppLanguage = (typeof platformConfig.localization.supportedLanguages)[number];

export function isFeatureEnabled(flag: FeatureFlagName): boolean {
  return platformConfig.featureFlags[flag];
}
