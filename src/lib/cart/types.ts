export const MAX_QUANTITY = 99;
export const MAX_CART_LINES = 50;
export interface CartItem {
  id: string; variantId: string; name: string; href: string | null; configuration: string;
  image: { source: string; alt: string } | null;
  quantity: number; maxQuantity: number; unitPriceMinor: string | null; lineTotalMinor: string | null;
  eligible: boolean; notice: string | null; priceChanged: boolean;
}
export interface Cart {
  items: CartItem[]; count: number; currency: "EGP"; subtotalMinor: string | null;
  revision: string | null; expiresAt: string | null; eligible: boolean; expired: boolean;
}
export const emptyCart = (): Cart => ({ items: [], count: 0, currency: "EGP", subtotalMinor: "0", revision: null, expiresAt: null, eligible: false, expired: false });
