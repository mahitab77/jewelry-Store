import type { ProductListOptions, ProductType, PublicMedia, PublicPrice } from "./types.ts";

export const PAGE_SIZE = 12;
export type CatalogueQuery = Record<string, string | string[] | undefined>;
export type ListingKind = "all" | "category" | "editorial";

export function isCatalogueSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= 160 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}

export function parseCatalogueQuery(query: CatalogueQuery): { page: number; sort: NonNullable<ProductListOptions["sort"]> } | null {
  const page = query.page ?? "1";
  const sort = query.sort ?? "newest";
  if (typeof page !== "string" || !/^[1-9][0-9]{0,3}$/.test(page) || (Number(page) - 1) * PAGE_SIZE > 10000) return null;
  if (sort !== "newest" && sort !== "name_asc") return null;
  return { page: Number(page), sort };
}

export function cataloguePageHref(path: string, page: number, sort: string): string {
  const query = new URLSearchParams();
  if (page > 1) query.set("page", String(page));
  if (sort === "name_asc") query.set("sort", sort);
  return path + (query.size ? `?${query}` : "");
}

export function formatEgp(price: PublicPrice | null): string {
  if (!price || price.currency !== "EGP" || !/^[0-9]+$/.test(price.amountMinor)) return "Price on Request";
  const minor = BigInt(price.amountMinor);
  const whole = new Intl.NumberFormat("en-EG", { maximumFractionDigits: 0 }).format(minor / BigInt(100));
  return `EGP ${whole}.${String(minor % BigInt(100)).padStart(2, "0")}`;
}

export function productTypeLabel(type: ProductType): string {
  return { ONE_OF_A_KIND: "One of a kind", REPEATABLE: "Signature piece", BESPOKE: "Bespoke commission" }[type];
}

// Approved local images or publication-gated Cloudinary image identifiers only.
export function publicImageSource(media: PublicMedia | null): string | null {
  return media?.type === "IMAGE" && (/^\/images\/[A-Za-z0-9_-]+\.(png|webp|jpe?g|avif)$/i.test(media.reference) ||
    /^\/catalogue-images\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(media.reference)) ? media.reference : null;
}

export function isDevelopmentEntry(entry: { id: string; name: string; slug: string }): boolean {
  return entry.id.startsWith("02000000-0000-4000-8000-") || entry.name.startsWith("[DEVELOPMENT]") || entry.slug.startsWith("dev-");
}
