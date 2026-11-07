import { ProductPhoto as Image } from "./ProductPhoto";
import Link from "next/link";
import type { PublicProduct } from "../../lib/catalogue/types.ts";
import { formatEgp, productTypeLabel, publicImageSource } from "../../lib/catalogue/presentation.ts";
import styles from "./catalogue.module.css";

export function JewelryCard({ product, requestQuotation = false }: { product: PublicProduct; requestQuotation?: boolean }) {
  const source = publicImageSource(product.primaryImage);
  return <article className={`${styles.card}${requestQuotation ? ` ${styles.cardWithRequest}` : ""}`}>
    <Link href={`/jewels/${product.slug}`} className={styles.cardLink}>
      <div className={styles.cardImage}>
        {source ? <Image src={source} alt={product.primaryImage?.altText?.trim() || product.name} fill sizes="(max-width: 639px) 90vw, (max-width: 1023px) 44vw, 360px" className={styles.jewelImage} />
          : <p className={`font-display ${styles.imagePlaceholder}`}>A closer look,<br />by appointment.</p>}
      </div>
      <div className={styles.cardCopy}>
        <p className={styles.eyebrow}>{productTypeLabel(product.productType)}</p>
        <h2 className="font-display">{product.name}</h2>
        {product.description ? <p className={styles.cardDescription}>{product.description}</p> : null}
        <p className={styles.price}>{product.fromPrice ? `From ${formatEgp(product.fromPrice)}` : "Price on Request"}</p>
        <p className={styles.availability}>{product.canPurchase ? "Available to purchase" : product.canEnquire ? "By private enquiry" : "Availability on request"}</p>
        <span className={styles.cardCta}>Discover the piece <span aria-hidden="true">→</span></span>
      </div>
    </Link>
    {requestQuotation && product.canEnquire ? <Link className={styles.cardQuotation} href={`/contact?${new URLSearchParams({ intent: "QUOTATION", product: product.slug }).toString()}`}>Request a Quotation<span className="sr-only"> for {product.name}</span></Link> : null}
  </article>;
}
