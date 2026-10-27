import { CatalogueListing, listingMetadata } from "../../../components/catalogue/CatalogueListing";
import type { CatalogueQuery } from "../../../lib/catalogue/presentation.ts";

type Props = { searchParams: Promise<CatalogueQuery> };
export async function generateMetadata({ searchParams }: Props) {
  return listingMetadata("all", "", searchParams);
}
export default function CollectionsPage({ searchParams }: Props) {
  return <CatalogueListing kind="all" searchParams={searchParams} />;
}
