export type ProductType = "ONE_OF_A_KIND" | "REPEATABLE" | "BESPOKE";
export type SalesMode = "DIRECT_PURCHASE" | "ENQUIRY_ONLY" | "BOTH";
// Decimal strings preserve PostgreSQL BIGINT/NUMERIC precision and JSON safety.
export interface PublicPrice { currency: "EGP"; amountMinor: string }
export interface PublicCategory { id: string; parentId: string | null; slug: string; name: string; description: string | null }
export interface PublicCollection { id: string; slug: string; name: string; description: string | null }
export interface PublicMedia { id: string; reference: string; type: "IMAGE" | "VIDEO"; altText: string | null; isPrimary: boolean }
export interface PublicGemstone {
  type: string; variety: string | null; shape: string; color: string;
  caratWeight: string | null; totalCaratWeight: string | null;
  treatmentInformation: string | null; quantity: number; role: "CENTER" | "ACCENT" | "OTHER";
}
export interface PublicVariant {
  id: string; sku: string; size: string | null; configuration: string | null;
  metalType: string | null; metalPurity: string | null; metalColor: string | null;
  price: PublicPrice | null;
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "NOT_TRACKED" | "ENQUIRY_ONLY";
  canPurchase: boolean;
}
export interface PublicProduct {
  id: string; slug: string; name: string; description: string | null;
  productType: ProductType; salesMode: SalesMode; primaryImage: PublicMedia | null;
  fromPrice: PublicPrice | null; pricingMode: "PRICED" | "PRICE_ON_REQUEST" | "ENQUIRY_ONLY";
  canPurchase: boolean; canEnquire: boolean;
}
export interface PublicProductDetail extends PublicProduct {
  media: PublicMedia[]; categories: PublicCategory[]; collections: PublicCollection[];
  variants: (PublicVariant & { gemstones: PublicGemstone[] })[];
}
export interface ProductListOptions {
  limit?: number; offset?: number; sort?: "newest" | "name_asc";
  categorySlug?: string; collectionSlug?: string;
}
export interface ProductPage { items: PublicProduct[]; limit: number; offset: number; hasMore: boolean }
