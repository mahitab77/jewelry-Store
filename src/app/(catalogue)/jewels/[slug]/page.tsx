import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { catalogueMetadata, loadJewel } from "../../../../lib/catalogue/storefront.ts";
import { isDevelopmentEntry, productTypeLabel } from "../../../../lib/catalogue/presentation.ts";
import { CatalogueNotice } from "../../../../components/catalogue/CatalogueShell";
import { JewelryGallery } from "../../../../components/catalogue/JewelryGallery";
import { JewelryOptions } from "../../../../components/catalogue/JewelryOptions";
import styles from "../../../../components/catalogue/catalogue.module.css";

type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props) {
  await connection();
  const { slug } = await params;
  const result = await loadJewel(slug);
  if (result.state === "not-found") notFound();
  return result.state === "ready" ? catalogueMetadata(result.value.name,
    result.value.description || `Explore ${result.value.name} with La Palme d’Or Gems.`, `/jewels/${slug}`, isDevelopmentEntry(result.value))
    : catalogueMetadata("Jewelry", "Speak personally with our boutique about the current selection.", `/jewels/${slug}`, true);
}

export default async function JewelPage({ params }: Props) {
  await connection();
  const result = await loadJewel((await params).slug);
  if (result.state === "not-found") notFound();
  if (result.state !== "ready") return <CatalogueNotice kind={result.state} />;
  const product = result.value;
  return <>
    {isDevelopmentEntry(product) ? <p className={styles.development} role="note">Development catalogue · Sample entries for preview only.</p> : null}
    <div className="maison-container">
      <nav aria-label="Breadcrumb" className={styles.breadcrumbs}><Link href="/">Home</Link><span aria-hidden="true">/</span>
        <Link href="/collections">Collections</Link>{product.categories[0] ? <><span aria-hidden="true">/</span>
          <Link href={`/collections/${product.categories[0].slug}`}>{product.categories[0].name}</Link></> : null}
      </nav>
      <div className={styles.detail}>
        <JewelryGallery key={product.id} media={product.media} name={product.name} />
        <section aria-labelledby="jewel-title">
          <p className={styles.eyebrow}>{productTypeLabel(product.productType)}</p><div className="gold-hairline mt-4" />
          <h1 id="jewel-title" className="font-display">{product.name}</h1>
          {product.description ? <p className={styles.description}>{product.description}</p> : null}
          <JewelryOptions key={product.id} variants={product.variants} productType={product.productType} salesMode={product.salesMode} canEnquire={product.canEnquire} />
          {product.categories.length || product.collections.length ? <nav className={styles.associations} aria-label="More from this selection">
            {product.categories.map((category) => <Link key={category.id} href={`/collections/${category.slug}`}>{category.name}</Link>)}
            {product.collections.map((collection) => <Link key={collection.id} href={`/collections/edit/${collection.slug}`}>{collection.name}</Link>)}
          </nav> : null}
        </section>
      </div>
    </div>
  </>;
}
