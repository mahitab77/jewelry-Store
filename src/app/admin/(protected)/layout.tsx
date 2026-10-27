import { requireAdminPage } from "../../../lib/admin/page-access.ts";

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return children;
}
