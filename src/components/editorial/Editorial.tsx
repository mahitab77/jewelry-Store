import Image from "next/image";
import Link from "next/link";
import styles from "./editorial.module.css";

export function EditorialHero({ eyebrow, title, children, image }: {
  eyebrow: string; title: string; children: React.ReactNode; image?: { src: string; alt: string };
}) {
  return <section className={`maison-container ${styles.hero} ${image ? styles.heroWithImage : ""}`}>
    <div><p className={styles.eyebrow}>{eyebrow}</p><div className="gold-hairline" />
      <h1 className="font-display text-balance">{title}</h1><div className={styles.introduction}>{children}</div>
    </div>
    {image ? <figure className={`royal-frame ${styles.heroImage}`}><Image src={image.src} alt={image.alt} fill preload
      sizes="(max-width: 899px) 90vw, 520px" className={styles.image} /></figure> : null}
  </section>;
}

export function EditorialSection({ eyebrow, title, children, light = false, id }: {
  eyebrow: string; title: string; children: React.ReactNode; light?: boolean; id?: string;
}) {
  return <>
    {light ? <div className="lp-transition lp-transition-black-to-cream" aria-hidden="true" /> : null}
    <section id={id} className={`${styles.section} ${light ? styles.light : ""}`}>
      <div className="maison-container"><p className={styles.eyebrow}>{eyebrow}</p><div className="gold-hairline" />
        <h2 className={`font-display ${styles.sectionTitle}`}>{title}</h2>{children}
      </div>
    </section>
    {light ? <div className="lp-transition lp-transition-cream-to-black" aria-hidden="true" /> : null}
  </>;
}

export function EditorialCTA({ title, children, href = "/appointment", label = "Private appointments" }: {
  title: string; children: React.ReactNode; href?: string; label?: string;
}) {
  return <section className={`maison-container ${styles.ctaSection}`}>
    <div className={`royal-frame appointment-panel ${styles.cta}`}>
      <p className={styles.eyebrow}>A personal conversation</p><div className="gold-hairline mx-auto" />
      <h2 className="font-display">{title}</h2><div>{children}</div>
      <Link href={href} className={`hero-cta hero-primary-button ${styles.button}`}>{label}</Link>
    </div>
  </section>;
}
