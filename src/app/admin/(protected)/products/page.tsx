import Link from "next/link";
import { headers } from "next/headers";
import { requireAdminPage } from "../../../../lib/admin/page-access.ts";
import { listAdminProducts } from "../../../../lib/admin/catalogue/read.ts";
import { formatEgp, publicImageSource } from "../../../../lib/catalogue/presentation.ts";
import { ProductPhoto } from "../../../../components/catalogue/ProductPhoto";
import styles from "../../../../components/admin/catalogue.module.css";

export const metadata = { title: "Product Catalogue | La Palme d'Or Gems" };
function label(value: string) { const words = value.toLowerCase().replaceAll("_", " "); return words.charAt(0).toUpperCase() + words.slice(1); }
export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const query = await searchParams;
  let listing: Awaited<ReturnType<typeof listAdminProducts>>;
  try { listing = await listAdminProducts(new Headers(await headers()), query); }
  catch { return <section><h1 className="font-display">Product catalogue</h1><p role="alert">The catalogue or selected filters are unavailable. Review the filters or contact the site operator.</p><Link href="/admin/products">Reset filters</Link></section>; }
  function pageHref(page: number) { const params = new URLSearchParams({ page: String(page) }); if (listing.search) params.set("q", listing.search); if (listing.status) params.set("status", String(listing.status)); if (listing.type) params.set("type", String(listing.type)); return `/admin/products?${params}`; }
  return <section className={styles.root}><div className={styles.toolbar}><Link href="/admin">Administration</Link><Link href="/admin/products/new" className={`hero-cta hero-primary-button ${styles.button}`}>Create product</Link></div>
    <h1 className="font-display">Product catalogue</h1>
    <form className={styles.filters} action="/admin/products" method="get"><label className={styles.field}>Search name, SKU or slug<input name="q" defaultValue={listing.search} maxLength={160} /></label>
      <label className={styles.field}>Publication status<select aria-label="Publication status" name="status" defaultValue={String(listing.status ?? "")}><option value="">All statuses</option>{["DRAFT", "PUBLISHED", "ARCHIVED"].map((value) => <option value={value} key={value}>{label(value)}</option>)}</select></label>
      <label className={styles.field}>Product type<select aria-label="Product type" name="type" defaultValue={String(listing.type ?? "")}><option value="">All types</option>{["ONE_OF_A_KIND", "REPEATABLE", "BESPOKE"].map((value) => <option value={value} key={value}>{label(value)}</option>)}</select></label>
      <button className={`hero-cta hero-secondary-button ${styles.button}`} type="submit">Filter products</button></form>
    <p className={styles.help}>Most recently updated first. Prices and available units come from active variants.</p>
    {listing.items.length ? <div className={styles.tableWrap} tabIndex={0} aria-label="Product table, scroll horizontally on smaller screens"><table className={styles.table}><thead><tr>{["Photograph", "Product / identifier", "Categories", "Type / mode", "Status", "EGP price", "Available units", "Updated", "Action"].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{listing.items.map((p) => { const source = p.imageProvider ? `/api/admin/catalogue/products/${p.id}/photos/${p.imageId}` : publicImageSource({ id: p.imageId ?? "", reference: p.imageReference ?? "", type: "IMAGE", altText: p.name, isPrimary: true }); return <tr key={p.id}>
        <td><div className={styles.thumb}>{source ? <ProductPhoto src={source} alt={p.name} fill sizes="84px" className={styles.photo} /> : "No photo"}</div></td>
        <td>{p.name}<br />{p.skus.join(", ") || p.slug}</td><td>{p.categories.join(", ") || "Unassigned"}</td><td>{label(p.productType)}<br />{label(p.salesMode)}</td><td>{label(p.status)}</td>
        <td>{formatEgp(p.priceMinor === null ? null : { currency: "EGP", amountMinor: p.priceMinor })}</td><td>{p.salesMode === "ENQUIRY_ONLY" ? "Enquiry only" : p.available}</td><td><time dateTime={p.updatedAt.replace(" ", "T") + "Z"}>{p.updatedAt.slice(0, 10)}<br />{p.updatedAt.slice(11)} UTC</time></td><td><Link href={`/admin/products/${p.id}/edit`}>Edit {p.name}</Link></td>
      </tr>; })}</tbody></table></div> : <p role="status">No products match these filters. Create a draft or adjust your search.</p>}
    <nav className={styles.actions} aria-label="Product list pages">{listing.page > 1 ? <Link href={pageHref(listing.page - 1)}>Previous page</Link> : null}<span>Page {listing.page}</span>{listing.hasMore ? <Link href={pageHref(listing.page + 1)}>Next page</Link> : null}</nav>
  </section>;
}
