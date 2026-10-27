import { EditorialCTA, EditorialHero, EditorialSection } from "../../../components/editorial/Editorial";
import { catalogueMetadata } from "../../../lib/catalogue/storefront.ts";
import styles from "../../../components/editorial/editorial.module.css";

export const metadata = catalogueMetadata("Services & Care", "General jewelry care guidance and questions to discuss with the boutique about inspection, fit, repair and redesign.", "/services", false);

export default function ServicesPage() {
  return <>
    <EditorialHero eyebrow="Services & care" title="A little attention, thoughtfully given."
      image={{ src: "/images/ring-emerald-no-bg.png", alt: "Green gemstone ring from La Palme d’Or Gems imagery" }}>
      <p>Care begins with knowing the piece: its stones, settings and any treatment information. The guidance here is general; cleaning or intervention should suit the individual jewel.</p>
    </EditorialHero>
    <EditorialSection eyebrow="General care guidance" title="Protect what makes a piece personal." light>
      <div className={styles.cards}>
        <article><h3>Wear with consideration</h3><p>Keep jewelry away from household chemicals and chlorinated water. Heat and sudden temperature changes can affect some gemstones and treatments.</p></article>
        <article><h3>Store pieces separately</h3><p>Use separate soft compartments or pouches to reduce contact between pieces. Take particular care with delicate settings and gemstones.</p></article>
        <article><h3>Clean for the material</h3><p>Ask for advice appropriate to the stone, metal and treatment history before choosing a cleaning method. Avoid assuming one solution is suitable for every piece.</p></article>
        <article><h3>Be cautious with machines</h3><p>Ultrasonic and steam cleaning can be unsuitable for fragile or treated stones. In particular, filled fractures in emeralds require careful handling.</p></article>
      </div>
      <nav className={styles.reading} aria-label="Care references"><a href="https://www.gia.edu/gia-news-research-Tips-Caring-Jewelry">GIA: caring for jewelry</a><a href="https://www.gia.edu/emerald-care-cleaning">GIA: emerald care</a></nav>
    </EditorialSection>
    <EditorialSection eyebrow="Questions for the boutique" title="An assessment before a promise.">
      <p>The topics below are matters to ask about, not a statement that every service is currently offered. Availability, suitability, scope and any terms need confirmation for your individual piece.</p>
      <div className={styles.cards}>
        <article><h3>Inspection & resizing</h3><p>Ask whether the setting or fit can be assessed, and whether any adjustment is appropriate for the piece.</p></article>
        <article><h3>Repair & restoration</h3><p>Describe the concern and ask what kind of assessment may be possible before work or arrangements are discussed.</p></article>
        <article><h3>Resetting & redesign</h3><p>Share what you would like to preserve and what you hope to change. Feasibility needs an individual discussion.</p></article>
        <article><h3>Personalisation</h3><p>Ask about the possibilities for an individual design rather than assuming a particular alteration is available.</p></article>
      </div>
    </EditorialSection>
    <EditorialCTA title="Begin with a considered question." href="/contact" label="Contact & availability"><p>For a piece-specific care or service enquiry, consult the current contact information.</p></EditorialCTA>
  </>;
}
