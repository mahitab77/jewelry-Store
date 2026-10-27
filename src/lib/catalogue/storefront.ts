import "server-only";
import { cache } from "react";
import type { Metadata } from "next";
import { DatabaseError } from "../db/config.ts";
import { getPublishedCategories, getPublishedCollections, getPublishedProductBySlug, getPublishedProducts,
  getProductsByCategorySlug, getProductsByCollectionSlug } from "./repository.ts";
import type { ProductListOptions, ProductPage, PublicCategory, PublicCollection, PublicProductDetail } from "./types.ts";
import { isCatalogueSlug, isDevelopmentEntry, PAGE_SIZE, type ListingKind } from "./presentation.ts";

export type CatalogueRead<T> = { state: "ready"; value: T } | { state: "not-found" | "not-configured" | "unavailable" };
export interface ListingData {
  title: string; description: string; categories: PublicCategory[]; collections: PublicCollection[];
  products: ProductPage; development: boolean;
}

async function safelyRead<T>(operation: () => Promise<T>): Promise<CatalogueRead<T>> {
  try { return { state: "ready", value: await operation() }; }
  catch (error) {
    if (!(error instanceof DatabaseError)) throw error;
    return { state: error.code === "DATABASE_NOT_CONFIGURED" ? "not-configured" : "unavailable" };
  }
}

// React.cache deduplicates metadata/page reads within a request, never across users.
export const loadListing = cache(async (kind: ListingKind, slug: string, page: number,
  sort: NonNullable<ProductListOptions["sort"]>): Promise<CatalogueRead<ListingData>> => {
  if (kind !== "all" && !isCatalogueSlug(slug)) return { state: "not-found" };
  const navigation = await safelyRead(() => Promise.all([getPublishedCategories(), getPublishedCollections()]));
  if (navigation.state !== "ready") return navigation;
  const [categories, collections] = navigation.value;
  const selected = kind === "category" ? categories.find((c) => c.slug === slug)
    : kind === "editorial" ? collections.find((c) => c.slug === slug) : null;
  if (kind !== "all" && !selected) return { state: "not-found" };
  const options = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, sort };
  const products = await safelyRead(() => kind === "category" ? getProductsByCategorySlug(slug, options)
    : kind === "editorial" ? getProductsByCollectionSlug(slug, options) : getPublishedProducts(options));
  if (products.state !== "ready") return products;
  return { state: "ready", value: {
    title: selected?.name ?? "The Collections",
    description: selected?.description ?? (kind === "all"
      ? "Discover natural stones, considered settings, and pieces shaped around a personal point of view."
      : "Explore the available pieces, or begin a private conversation with our boutique."),
    categories, collections, products: products.value,
    development: [...categories, ...collections, ...products.value.items].some(isDevelopmentEntry),
  } };
});

export const loadJewel = cache(async (slug: string): Promise<CatalogueRead<PublicProductDetail>> => {
  if (!isCatalogueSlug(slug)) return { state: "not-found" };
  const result = await safelyRead(() => getPublishedProductBySlug(slug));
  if (result.state !== "ready") return result;
  return result.value ? { state: "ready", value: result.value } : { state: "not-found" };
});

export function catalogueMetadata(title: string, description: string, path: string, noindex: boolean): Metadata {
  let canonical: string | undefined;
  // A verified deployment origin must be configured; never invent a live domain.
  try {
    const origin = new URL(process.env.SITE_URL ?? "");
    if (origin.protocol === "https:" && !origin.username && !origin.password && origin.pathname === "/" && !origin.search && !origin.hash) {
      canonical = new URL(path, origin).toString();
    }
  } catch { /* Omit canonical until SITE_URL is configured. */ }
  const pageTitle = `${title} | La Palme d’Or Gems`;
  return { title: pageTitle, description: description.slice(0, 160),
    keywords: ["La Palme d’Or Gems", "jewelry", "Egypt"],
    robots: { index: !noindex, follow: true },
    alternates: canonical ? { canonical } : undefined,
    openGraph: { title: pageTitle, description: description.slice(0, 160), type: "website" },
  };
}
