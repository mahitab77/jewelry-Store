import { headers } from "next/headers";
import { requireAdminPage } from "../../../../lib/admin/page-access.ts";
import { readTaxonomy } from "../../../../lib/admin/catalogue/taxonomy.ts";
import { TaxonomyEditor } from "../../../../components/admin/TaxonomyEditor";

export const metadata = { title: "Categories and Collections | La Palme d'Or Gems" };
export default async function TaxonomyPage() {
  await requireAdminPage();
  const initial = await readTaxonomy(new Headers(await headers()));
  return <TaxonomyEditor initial={initial} />;
}
