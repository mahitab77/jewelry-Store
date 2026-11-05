import type { ProductInput, ProductSubmission, StoneInput, VariantInput } from "./types.ts";
import { quotationOnly } from "../../commerce-policy.ts";

export class CatalogueAdminError extends Error {
  readonly status: number;
  readonly fieldPath?: string;
  constructor(message: string, status = 400, fieldPath?: string) { super(message); this.name = "CatalogueAdminError"; this.status = status; this.fieldPath = fieldPath; }
}
export function fail(message: string, status = 400): never { throw new CatalogueAdminError(message, status); }
function field<T>(path: string, read: () => T): T {
  try { return read(); }
  catch (error) {
    if (error instanceof CatalogueAdminError && error.status === 400) throw new CatalogueAdminError(error.message, error.status, path + (error.fieldPath ? "." + error.fieldPath : ""));
    throw error;
  }
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) fail("Invalid record identifier.");
  return value as string;
}
export function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail("Unexpected or invalid fields. Reload the editor and try again.");
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max = 160, required = false): string {
  if (typeof value !== "string") fail(`${label} must be text.`);
  const result = (value as string).trim();
  if ((required && !result) || result.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(result)) fail(`${label} is missing or too long.`);
  return result;
}
export function integer(value: unknown, label: string, min = 0, max = 10000): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) fail(`${label} must be an integer from ${min} to ${max}.`);
  return value as number;
}
function choice<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(`Invalid ${label}.`);
  return value as T;
}
function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label} contains too many entries or is invalid.`);
  return value as unknown[];
}
export function egpToMinor(value: string): string | null {
  if (!value) return null;
  if (!/^(?:0|[1-9][0-9]{0,16})(?:\.[0-9]{1,2})?$/.test(value)) fail("Enter an EGP price with at most two decimal places, without commas.");
  const [whole, part = ""] = value.split(".");
  const result = BigInt(whole) * BigInt(100) + BigInt(part.padEnd(2, "0"));
  if (result > BigInt("9223372036854775807")) fail("The price exceeds the supported range.");
  return result.toString();
}
export function minorToEgp(value: string | null): string {
  if (value === null) return "";
  const minor = BigInt(value);
  return `${minor / BigInt(100)}.${(minor % BigInt(100)).toString().padStart(2, "0")}`;
}
export function weight(value: unknown): string {
  const input = text(value, "Carat weight", 20);
  if (!input) return "";
  if (!/^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,4})?$/.test(input)) fail("Carat weights need up to four decimal places and must be below 100000000.");
  const [whole, decimal = ""] = input.split(".");
  if (BigInt(whole + decimal.padEnd(4, "0")) === BigInt(0)) fail("Carat weight must be positive when supplied.");
  return `${whole}.${decimal.padEnd(4, "0")}`;
}
export function metalGrams(value: unknown): string {
  const input = text(value, "Metal weight in grams", 20);
  if (!input) return "";
  if (!/^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,3})?$/.test(input)) fail("Metal weight needs up to three decimal places in grams and must be below 10000000.");
  const [whole, decimal = ""] = input.split(".");
  if (BigInt(whole + decimal.padEnd(3, "0")) === BigInt(0)) fail("Metal weight must be positive when supplied.");
  return `${whole}.${decimal.padEnd(3, "0")}`;
}
const stoneKeys = ["associationId", "kind", "type", "variety", "shape", "color", "caratWeight", "origin", "treatment", "laboratory", "reportReference", "role", "quantity", "totalCaratWeight", "displayOrder"];
function stone(value: unknown): StoneInput {
  const s = object(value, stoneKeys);
  const result: StoneInput = {
    associationId: s.associationId === undefined ? undefined : uuid(s.associationId),
    kind: choice(s.kind, ["INDIVIDUAL", "GROUP"], "gemstone kind"),
    type: field("type", () => text(s.type, "Stone type", 100, true)), variety: field("variety", () => text(s.variety, "Variety")), shape: field("shape", () => text(s.shape, "Shape", 100, true)), color: field("color", () => text(s.color, "Colour", 100, true)),
    caratWeight: field("caratWeight", () => weight(s.caratWeight)), origin: field("origin", () => text(s.origin, "Origin")), treatment: field("treatment", () => text(s.treatment, "Treatment information", 1000)),
    laboratory: field("laboratory", () => text(s.laboratory, "Laboratory")), reportReference: field("reportReference", () => text(s.reportReference, "Report reference", 250)),
    role: choice(s.role, ["CENTER", "ACCENT", "OTHER"], "gemstone role"), quantity: field("quantity", () => integer(s.quantity, "Gemstone quantity", 1)),
    totalCaratWeight: field("totalCaratWeight", () => weight(s.totalCaratWeight)), displayOrder: field("displayOrder", () => integer(s.displayOrder, "Gemstone display order")),
  };
  if (result.kind === "INDIVIDUAL" && result.quantity !== 1) field("quantity", () => fail("An individual gemstone must have quantity one."));
  if (result.reportReference && !result.laboratory) field("laboratory", () => fail("Provide a laboratory with a report reference."));
  return result;
}
const variantKeys = ["id", "sku", "size", "configuration", "metalType", "metalPurity", "metalColor", "metalWeightGrams", "metalWeightBasis", "active", "displayOrder", "priceEGP", "initialStock", "stockReason", "gemstones"];
function variant(value: unknown): VariantInput {
  const v = object(value, variantKeys);
  const sku = field("sku", () => { const value = text(v.sku === undefined ? "" : v.sku, "SKU", 80); if (value && !/^[A-Z0-9][A-Z0-9._-]*$/.test(value)) fail("SKU must use uppercase letters, numbers, dots, underscores or hyphens."); return value; });
  if (typeof v.active !== "boolean") fail("Choose the variant active state.");
  const result: VariantInput = {
    id: v.id === undefined ? undefined : uuid(v.id), sku, size: field("size", () => text(v.size, "Size", 100)), configuration: field("configuration", () => text(v.configuration, "Configuration", 250)),
    metalType: field("metalType", () => text(v.metalType, "Metal")), metalPurity: field("metalPurity", () => text(v.metalPurity, "Metal purity")), metalColor: field("metalColor", () => text(v.metalColor, "Metal colour")),
    active: v.active as boolean, displayOrder: field("displayOrder", () => integer(v.displayOrder, "Variant display order")), priceEGP: field("priceEGP", () => { const value = text(v.priceEGP, "Price", 24); egpToMinor(value); return value; }),
    gemstones: field("gemstones", () => array(v.gemstones, "Gemstones", 20).map((value, index) => field(String(index), () => stone(value)))),
  };
  if (v.metalWeightGrams !== undefined || v.metalWeightBasis !== undefined) {
    result.metalWeightGrams = field("metalWeightGrams", () => metalGrams(v.metalWeightGrams ?? ""));
    result.metalWeightBasis = field("metalWeightBasis", () => choice<"" | "ACTUAL" | "ESTIMATED">(v.metalWeightBasis ?? "", ["", "ACTUAL", "ESTIMATED"], "metal weight basis"));
    if (Boolean(result.metalWeightGrams) !== Boolean(result.metalWeightBasis)) field(result.metalWeightGrams ? "metalWeightBasis" : "metalWeightGrams", () => fail("Provide both a metal weight in grams and an actual or estimated measurement basis, or leave both unknown."));
  }
  if (result.id && (v.initialStock !== undefined || v.stockReason !== undefined)) fail("Use the separate inventory adjustment to change existing stock.");
  if (!result.id) {
    result.initialStock = field("initialStock", () => integer(v.initialStock ?? 0, "Initial stock", 0, 1000000));
    result.stockReason = field("stockReason", () => text(v.stockReason ?? "", "Initial stock reason", 240, result.initialStock! > 0));
  }
  return result;
}
export function parseSubmission(value: unknown): ProductSubmission {
  const root = object(value, ["product", "revision", "action"]);
  const p = object(root.product, ["name", "slug", "description", "productType", "salesMode", "categoryIds", "collectionIds", "variants", "entryMode"]);
  if (p.entryMode !== undefined && p.entryMode !== "basic") fail("Invalid product entry mode.");
  const ids = (value: unknown, name: string) => { const list = array(value, name, 30).map(uuid); if (new Set(list).size !== list.length) fail(`Duplicate ${name}.`); return list; };
  const product: ProductInput = {
    name: field("product.name", () => text(p.name, "Product name", 200, true)), slug: field("product.slug", () => text(p.slug === undefined ? "" : p.slug, "Slug", 160)), description: field("product.description", () => text(p.description, "Description", 10000)),
    productType: choice(p.productType, ["ONE_OF_A_KIND", "REPEATABLE", "BESPOKE"], "product type"),
    salesMode: choice(p.salesMode, ["DIRECT_PURCHASE", "ENQUIRY_ONLY", "BOTH"], "sales mode"),
    categoryIds: ids(p.categoryIds, "categories"), collectionIds: ids(p.collectionIds, "collections"), variants: field("product.variants", () => array(p.variants, "Variants", 30).map((value, index) => field(String(index), () => variant(value)))),
  };
  if (p.entryMode === "basic") {
    product.entryMode = "basic";
    if (product.variants.length > 1) field("product.variants", () => fail("Use Sizes and Variants to manage multiple configurations."));
    if (!product.variants.length) product.variants.push({ sku: "", size: "", configuration: "", metalType: "", metalPurity: "", metalColor: "", active: true, displayOrder: 0, priceEGP: "", initialStock: 0, stockReason: "", gemstones: [] });
  }
  if (product.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(product.slug)) field("product.slug", () => fail("Use a lowercase, hyphenated URL slug."));
  if (product.productType === "BESPOKE" && product.salesMode !== "ENQUIRY_ONLY") fail("Bespoke products must be enquiry only.");
  if (product.productType === "ONE_OF_A_KIND" && product.variants.length > 1) fail("A one-of-a-kind jewel has one inventory-owning variant.");
  const skus = new Set<string>(), configurations = new Set<string>(), variants = new Set<string>();
  for (const [index, v] of product.variants.entries()) {
    const path = "product.variants." + index + ".";
    if ((v.sku && skus.has(v.sku)) || (v.id && variants.has(v.id))) field(path + "sku", () => fail("Variants and SKUs must be unique."));
    if (v.sku) skus.add(v.sku); if (v.id) variants.add(v.id);
    if (!quotationOnly() && product.salesMode === "ENQUIRY_ONLY" && v.priceEGP) field(path + "priceEGP", () => fail("Clear selling prices for enquiry-only products."));
    if (product.productType === "BESPOKE" && (v.initialStock ?? 0) !== 0) field(path + "initialStock", () => fail("Bespoke stock must be zero."));
    if (product.productType === "ONE_OF_A_KIND" && (v.initialStock ?? 0) > 1) field(path + "initialStock", () => fail("One-of-a-kind stock cannot exceed one."));
    const key = JSON.stringify([v.size, v.configuration, v.metalType, v.metalPurity, v.metalColor].map((s) => s.toLowerCase()));
    if (v.active && configurations.has(key)) field(path + "configuration", () => fail("Active variants need distinct size, metal or configuration details."));
    if (v.active) configurations.add(key);
  }
  const action = choice(root.action, ["save", "publish", "unpublish", "archive"], "product action");
  const revision = root.revision === undefined ? undefined : text(root.revision, "Editor version", 40, true);
  if (revision && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(revision)) fail("Reload this editor before saving.");
  return { product, action, revision };
}
