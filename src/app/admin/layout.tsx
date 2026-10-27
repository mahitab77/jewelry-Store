import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import styles from "../../components/admin/admin.module.css";

export const metadata: Metadata = { title: "Administration | La Palme d'Or Gems", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className={`luxury-page ${styles.root}`}>
    <a className={styles.skip} href="#admin-content">Skip to content</a>
    <header className={styles.header}><div className="maison-container">
      <Link href="/" aria-label="La Palme d’Or Gems homepage"><Image src="/images/logo-la-palme-dor-no-bg.png" alt="La Palme d’Or Gems" width={128} height={84} /></Link>
      <span className={styles.eyebrow}>Private administration</span>
    </div></header>
    <main id="admin-content" className={`maison-container ${styles.main}`}>{children}</main>
  </div>;
}
