import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { catalogueMetadata, loadListing } from "../../lib/catalogue/storefront.ts";
import { cataloguePageHref, isCatalogueSlug, parseCatalogueQuery, type CatalogueQuery, type ListingKind } from "../../lib/catalogue/presentation.ts";
import { CatalogueNotice } from "./CatalogueShell";
import { JewelryCard } from "./JewelryCard";
import { RingsIntroduction, RingsPersonalization } from "./RingsEditorial";
import styles from "./catalogue.module.css";

async function listingRequest(kind: ListingKind, slug: string, searchParams: Promise<CatalogueQuery>) {
  await connection();
  if (kind !== "all" && !isCatalogueSlug(slug)) notFound();
  const path = kind === "all" ? "/collections" : kind === "category" ? `/collections/${slug}` : `/collections/edit/${slug}`;
  const query = parseCatalogueQuery(await searchParams);
  if (!query) redirect(path);
  const result = await loadListing(kind, slug, query.page, query.sort);
  if (result.state === "not-found") notFound();
  return { result, query, path };
}

export async function listingMetadata(kind: ListingKind, slug: string, searchParams: Promise<CatalogueQuery>) {
  const { result, query, path } = await listingRequest(kind, slug, searchParams);
  return result.state === "ready"
    ? catalogueMetadata(result.value.title, result.value.description, cataloguePageHref(path, query.page, query.sort),
      result.value.development || result.value.products.items.length === 0)
    : catalogueMetadata("Our Collections", "Discover the collections or speak personally with La Palme d’Or Gems.", path, true);
}

export async function CatalogueListing({ kind, slug = "", searchParams }: {
  kind: ListingKind; slug?: string; searchParams: Promise<CatalogueQuery>;
}) {
  const { result, query, path } = await listingRequest(kind, slug, searchParams);
  if (result.state !== "ready") return <CatalogueNotice kind={result.state === "not-found" ? "not-found" : result.state} />;
  const { title, description, categories, collections, products, development } = result.value;
  const rings = kind === "category" && slug === "rings";
  const navigation = <>
    <nav className={styles.categoryNav} aria-label="Jewelry categories">
      <Link href="/collections" aria-current={kind === "all" ? "page" : undefined}>All jewelry</Link>
      {categories.map((category) => <Link key={category.id} href={`/collections/${category.slug}`} aria-current={kind === "category" && category.slug === slug ? "page" : undefined}>{category.name}</Link>)}
    </nav>
    {collections.length ? <nav className={styles.editorialNav} aria-label="Editorial collections"><span>Editorial collections</span>{collections.map((collection) => <Link key={collection.id} href={`/collections/edit/${collection.slug}`} aria-current={kind === "editorial" && collection.slug === slug ? "page" : undefined}>{collection.name}</Link>)}</nav> : null}
  </>;
  return <>
    {development ? <p className={styles.development} role="note">Development catalogue · Sample entries for preview only.</p> : null}
    {rings ? <RingsIntroduction title={title} description={description}>{navigation}</RingsIntroduction> : <section className={`maison-container lp-transition-content ${styles.intro}`}>
      <p className={styles.eyebrow}>{kind === "editorial" ? "An editorial collection" : "Natural stones. Personal expression."}</p>
      <div className="gold-hairline mx-auto" />
      <h1 className="font-display text-balance">{title}</h1><p>{description}</p>
      {navigation}
    </section>}
    <div className="lp-transition lp-transition-black-to-cream" aria-hidden="true" />
    <section id={rings ? "rings-selection" : undefined} className={styles.catalogueBody} aria-label="Jewelry selection">
      <div className="maison-container lp-transition-content">
        <div className={styles.listingToolbar}>
          <p>{products.items.length ? `${products.items.length} ${products.items.length === 1 ? "piece" : "pieces"} on this page` : "The selection"}</p>
          <nav aria-label="Sort jewelry"><Link href={cataloguePageHref(path, 1, "newest")} aria-current={query.sort === "newest" ? "true" : undefined}>Latest</Link>
            <Link href={cataloguePageHref(path, 1, "name_asc")} aria-current={query.sort === "name_asc" ? "true" : undefined}>Name</Link></nav>
        </div>
        {products.items.length ? <div className={styles.grid}>{products.items.map((product) => <JewelryCard key={product.id} product={product} requestQuotation={rings} />)}</div>
          : <div className={styles.empty}><p className={styles.eyebrow}>A considered selection</p>
            <h2 className="font-display">{query.page > 1 ? "You have reached the end of this selection." : "The next chapter is taking shape."}</h2>
            <p>{query.page > 1 ? "Return to the beginning to explore the available pieces." : "There are no published pieces in this collection at present. Our boutique is here to help with a personal request."}</p>
            <Link href={query.page > 1 ? path : "/contact"}>{query.page > 1 ? "Back to the first page" : "Speak with the boutique"}</Link>
          </div>}
        {query.page > 1 || products.hasMore ? <nav className={styles.pagination} aria-label="Catalogue pagination">
          {query.page > 1 ? <Link href={cataloguePageHref(path, query.page - 1, query.sort)} rel="prev">← Previous page</Link> : <span />}
          <span>Page {query.page}</span>
          {products.hasMore && query.page < 834 ? <Link href={cataloguePageHref(path, query.page + 1, query.sort)} rel="next">Next page →</Link> : <span />}
        </nav> : null}
      </div>
    </section>
    <div className="lp-transition lp-transition-cream-to-black" aria-hidden="true" />
    {rings ? <RingsPersonalization /> : null}
  </>;
}
