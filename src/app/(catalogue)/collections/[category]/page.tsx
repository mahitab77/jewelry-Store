import { CatalogueListing, listingMetadata } from "../../../../components/catalogue/CatalogueListing";
import type { CatalogueQuery } from "../../../../lib/catalogue/presentation.ts";

type Props = { params: Promise<{ category: string }>; searchParams: Promise<CatalogueQuery> };
export async function generateMetadata({ params, searchParams }: Props) {
  return listingMetadata("category", (await params).category, searchParams);
}
export default async function CategoryPage({ params, searchParams }: Props) {
  return <CatalogueListing kind="category" slug={(await params).category} searchParams={searchParams} />;
}
