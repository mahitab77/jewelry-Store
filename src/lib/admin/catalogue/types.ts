import type { ProductType, SalesMode } from "../../catalogue/types.ts";

export interface StoneInput {
  associationId?: string;
  kind: "INDIVIDUAL" | "GROUP";
  type: string; variety: string; shape: string; color: string; caratWeight: string;
  origin: string; treatment: string; laboratory: string; reportReference: string;
  role: "CENTER" | "ACCENT" | "OTHER"; quantity: number; totalCaratWeight: string; displayOrder: number;
}
export interface VariantInput {
  id?: string; sku: string; size: string; configuration: string;
  metalType: string; metalPurity: string; metalColor: string;
  metalWeightGrams?: string; metalWeightBasis?: "" | "ACTUAL" | "ESTIMATED";
  active: boolean; displayOrder: number; priceEGP: string;
  initialStock?: number; stockReason?: string; gemstones: StoneInput[];
}
export interface ProductInput {
  name: string; slug: string; description: string; productType: ProductType; salesMode: SalesMode;
  categoryIds: string[]; collectionIds: string[]; variants: VariantInput[];
  entryMode?: "basic";
}
export interface EditorMedia { id: string; reference: string; altText: string; primary: boolean; displayOrder: number; provider: boolean }
export interface EditorVariant extends VariantInput { id: string; onHand: number | null; reserved: number; available: number; stockUpdatedAt: string | null }
export interface EditorProduct extends Omit<ProductInput, "variants"> {
  id: string; revision: string; status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  slugLocked: boolean; variants: EditorVariant[]; media: EditorMedia[];
}
export interface CatalogueChoices { categories: { id: string; name: string; visible: boolean }[]; collections: { id: string; name: string; status: string }[] }
export type ProductAction = "save" | "publish" | "unpublish" | "archive";
export interface ProductSubmission { product: ProductInput; revision?: string; action: ProductAction }
export interface ProductListRow {
  id: string; name: string; slug: string; productType: ProductType; status: string; salesMode: SalesMode;
  updatedAt: string; imageId: string | null; imageReference: string | null; imageProvider: boolean;
  categories: string[]; skus: string[]; priceMinor: string | null; available: number;
}
