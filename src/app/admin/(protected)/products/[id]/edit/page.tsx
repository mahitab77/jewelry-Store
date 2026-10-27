import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireAdminPage } from "../../../../../../lib/admin/page-access.ts";
import { catalogueChoices, productAuditHistory, readEditor } from "../../../../../../lib/admin/catalogue/read.ts";
import { cloudinaryConfigured } from "../../../../../../lib/media/cloudinary.ts";
import { ProductEditor } from "../../../../../../components/admin/ProductEditor";
export const metadata = { title: "Edit Product | La Palme d'Or Gems" };
export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage(); const { id } = await params;
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) notFound();
  const requestHeaders = new Headers(await headers());
  const [product, choices, history] = await Promise.all([readEditor(requestHeaders, id), catalogueChoices(requestHeaders), productAuditHistory(requestHeaders, id)]);
  if (!product) notFound();
  return <ProductEditor key={product.id} product={product} choices={choices} initialHistory={history} uploadsConfigured={cloudinaryConfigured()} />;
}
