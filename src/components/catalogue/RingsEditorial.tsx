import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./rings.module.css";

// Supplied editorial studies are deliberately separate from product media.
// No product identity, specification or availability is inferred from an image.
const studies = {
  blue: { src: "/images/rings/editorial/royal-blue-center-stone-ring-satin.webp", width: 1024, height: 1031, alt: "Ring design with a deep-blue centre and pale accents, resting on ivory satin" },
  butterfly: { src: "/images/rings/editorial/butterfly-motif-ring-ivory-satin.webp", width: 816, height: 816, alt: "Open butterfly-motif ring design on softly folded ivory satin" },
  open: { src: "/images/rings/editorial/open-two-stone-statement-ring.webp", width: 896, height: 736, alt: "Open ring design with two contrasting pale and pink-toned centres on ivory satin" },
} as const;

export function RingsIntroduction({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className={`maison-container lp-transition-content ${styles.introduction}`} aria-labelledby="rings-title">
    <div className={styles.hero}>
      <div className={styles.copy}>
        <div className="gold-hairline" aria-hidden="true" />
        <h1 id="rings-title" className="font-display">{title}</h1>
        <p className={styles.lead}>{description}</p>
        <p>Explore the published selection below, or begin a ring design conversation shaped around you. Prices and details are confirmed personally.</p>
        <div className={styles.actions}>
          <a href="#rings-selection" className={`hero-cta hero-primary-button ${styles.action}`}>Explore the selection</a>
          <Link href="/appointment" className={`hero-cta hero-secondary-button ${styles.action}`}>Consult the Designer</Link>
        </div>
      </div>
      <figure className={styles.heroFigure}>
        <Image {...studies.blue} alt={studies.blue.alt} preload sizes="(min-width: 1024px) 46vw, (min-width: 640px) 70vw, 90vw" className={styles.image} />
        <figcaption>Editorial design inspiration, separate from the available pieces below.</figcaption>
      </figure>
    </div>
    {children}
  </section>;
}

export function RingsPersonalization() {
  return <section className={`maison-container lp-transition-content ${styles.personalization}`} aria-labelledby="rings-personal-title">
    <div className={styles.personalCopy}>
      <h2 id="rings-personal-title" className="font-display">Make it personal.</h2>
      <p>A different setting. A new proportion. A design that begins with a conversation. Share what you have in mind and discuss the possibilities with the designer.</p>
      <div className={styles.actions}>
        <Link href="/contact?intent=BESPOKE" className={`hero-cta hero-primary-button ${styles.action}`}>Discuss a bespoke ring</Link>
        <Link href="/appointment" className={styles.textLink}>Zoom or Boutique Consultation</Link>
      </div>
      <p className={styles.caption}>These ring studies illustrate design directions; they are not product listings or confirmed inventory.</p>
    </div>
    <figure className={styles.butterfly}><Image {...studies.butterfly} alt={studies.butterfly.alt} sizes="(min-width: 1024px) 26vw, (min-width: 640px) 42vw, 90vw" loading="lazy" className={styles.image} /></figure>
    <figure className={styles.open}><Image {...studies.open} alt={studies.open.alt} sizes="(min-width: 1024px) 26vw, (min-width: 640px) 42vw, 90vw" loading="lazy" className={styles.image} /></figure>
  </section>;
}
