import type { Cart } from "../cart/types.ts";
export type CheckoutStep = "CART_REVIEW" | "CUSTOMER_DETAILS" | "FULFILLMENT" | "REVIEW_READY";
export interface CheckoutDetails {
  fullName: string; email: string; phone: string; method: "" | "PRIVATE_DELIVERY" | "BOUTIQUE_COLLECTION";
  countryCode: "EG"; governorate: string; city: string; street: string; building: string;
  floorUnit: string; instructions: string; locationId: string;
}
export interface BoutiqueLocation { id: string; name: string; governorate: string; city: string; street: string }
export interface CheckoutView {
  cart: Cart; fingerprint: string; details: CheckoutDetails; locations: BoutiqueLocation[];
  draft: { revision: string; expiresAt: string } | null; state: CheckoutStep; changed: boolean;
  savingAvailable: boolean;
}
export type CheckoutErrors = Partial<Record<keyof CheckoutDetails | "cart", string>>;
export const emptyDetails = (): CheckoutDetails => ({ fullName: "", email: "", phone: "", method: "", countryCode: "EG", governorate: "", city: "", street: "", building: "", floorUnit: "", instructions: "", locationId: "" });
