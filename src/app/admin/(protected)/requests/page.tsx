import Link from "next/link";
import { requireAdminPage } from "../../../../lib/admin/page-access.ts";
import { hasPermission } from "../../../../lib/admin/policy.ts";
import { RequestsInbox } from "../../../../components/admin/RequestsInbox";
export const metadata = { title: "Boutique Requests | La Palme d'Or Gems", robots: { index: false, follow: false } };
export default async function RequestsPage() {
  const admin = await requireAdminPage();
  if (!hasPermission(admin.role,"operations:manage")) return <section><h1 className="font-display">Request access unavailable</h1><p>Operations-authorized staff access is required to view private customer requests.</p><Link href="/admin">Administration</Link></section>;
  // History navigation can reuse this RSC payload. Customer records belong only
  // in the client's fresh, authorized API response, never in cached page props.
  return <RequestsInbox />;
}
