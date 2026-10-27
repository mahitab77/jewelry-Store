import { CatalogueListing, listingMetadata } from "../../../../../components/catalogue/CatalogueListing";
import type { CatalogueQuery } from "../../../../../lib/catalogue/presentation.ts";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<CatalogueQuery> };
export async function generateMetadata({ params, searchParams }: Props) {
  return listingMetadata("editorial", (await params).slug, searchParams);
}
export default async function EditorialCollectionPage({ params, searchParams }: Props) {
  return <CatalogueListing kind="editorial" slug={(await params).slug} searchParams={searchParams} />;
}
