import Link from "next/link";
import { CatalogueHeader } from "./CatalogueHeader";
import styles from "./catalogue.module.css";
import { connection } from "next/server";
import { quotationOnly } from "../../lib/commerce-policy.ts";

export async function CatalogueShell({ children }: { children: React.ReactNode }) {
  await connection();
  return <div className={`luxury-page ${styles.root}`}>
    <a className={styles.skipLink} href="#catalogue-content">Skip to content</a>
    <CatalogueHeader quotationOnly={quotationOnly()} />
    <main id="catalogue-content">{children}</main>
    <footer className={styles.footer}>
      <div className="maison-container lp-transition-content">
        <p className="font-display">La Palme d&apos;Or Gems</p>
        <p>Bespoke natural stone jewelry, privately designed in Egypt.</p>
        <nav aria-label="Boutique information">
          <Link href="/collections">The collections</Link><Link href="/bespoke">Bespoke</Link><Link href="/gemstones">Gemstones</Link>
          <Link href="/maison">The Maison</Link><Link href="/services">Services & Care</Link>
          <Link href="/appointment">Private appointments</Link><Link href="/contact">Contact the boutique</Link>
        </nav>
      </div>
    </footer>
  </div>;
}

export function CatalogueNotice({ kind }: { kind: "not-configured" | "unavailable" | "not-found" }) {
  const title = kind === "not-configured" ? "Our collection is being prepared."
    : kind === "unavailable" ? "A little patience, please." : "This piece of the collection could not be found.";
  const message = kind === "not-configured" ? "For a personal introduction to our available jewelry, please contact the boutique."
    : kind === "unavailable" ? "The catalogue is temporarily unavailable. Please try again shortly, or speak with our boutique."
      : "The page may no longer be available. Explore the current collections or speak with us about a bespoke piece.";
  return <section className={`maison-container ${styles.notice}`}>
    <p className={styles.eyebrow}>La Palme d&apos;Or Gems</p><div className="gold-hairline mx-auto" />
    <h1 className="font-display">{title}</h1><p>{message}</p>
    <Link className={`hero-cta hero-primary-button ${styles.button}`} href={kind === "not-found" ? "/collections" : "/contact"}>
      {kind === "not-found" ? "Explore the collections" : "Contact the boutique"}
    </Link>
  </section>;
}
