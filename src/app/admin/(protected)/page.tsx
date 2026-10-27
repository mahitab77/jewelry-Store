import { requireAdminPage } from "../../../lib/admin/page-access.ts";
import { AdminSignOut } from "../../../components/admin/AdminSignOut";
import Link from "next/link";
import styles from "../../../components/admin/admin.module.css";

export default async function AdminPage() {
  const admin = await requireAdminPage();
  return <>
    <div className={styles.heading}><div><p className={styles.eyebrow}>The maison · administration</p><div className="gold-hairline" />
      <h1 className="font-display">Welcome, {admin.displayName}.</h1><p>Signed in as {admin.role.replaceAll("_", " ").toLowerCase()}.</p>
    </div><AdminSignOut /></div>
    <section className={styles.plans} aria-labelledby="future-areas"><h2 id="future-areas" className="font-display">A foundation for the work ahead.</h2>
      <p>Your access is active. Manage the catalogue, or review the future areas below.</p>
      <div className={styles.cards}>
        <article><h3>Catalogue</h3><p>Manage products, photographs, pricing and inventory.</p><Link href="/admin/products">Manage catalogue</Link></article>
        <article><h3>Orders</h3><p>Future operational workflows for authorised team members.</p><span>Not yet available</span></article>
        <article><h3>Enquiries</h3><p>Future handling of boutique conversations.</p><span>Not yet available</span></article>
      </div>
    </section>
  </>;
}
