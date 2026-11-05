import { headers } from "next/headers";
import { requireAdminPage } from "../../../../../lib/admin/page-access.ts";
import { catalogueChoices } from "../../../../../lib/admin/catalogue/read.ts";
import { cloudinaryConfigured } from "../../../../../lib/media/cloudinary.ts";
import { ProductEditor } from "../../../../../components/admin/ProductEditor";
import { quotationOnly } from "../../../../../lib/commerce-policy.ts";

export const metadata = { title: "Create Product | La Palme d'Or Gems" };
export default async function NewProductPage() {
  await requireAdminPage();
  const choices = await catalogueChoices(new Headers(await headers()));
  return <ProductEditor product={null} choices={choices} initialHistory={[]} uploadsConfigured={cloudinaryConfigured()} quotationOnly={quotationOnly()} />;
}
