import Link from "next/link";
import { EditorialCTA, EditorialHero, EditorialSection } from "../../../components/editorial/Editorial";
import { catalogueMetadata } from "../../../lib/catalogue/storefront.ts";
import styles from "../../../components/editorial/editorial.module.css";

export const metadata = catalogueMetadata("The Maison", "La Palme d’Or Gems: Egyptian jewelry heritage since 1973, natural stones and a tradition of private bespoke commissions.", "/maison", false);

export default function MaisonPage() {
  return <>
    <EditorialHero eyebrow="Heritage and trust" title="A house shaped by personal commissions."
      image={{ src: "/images/The-Grand-Phoenix-Full-no-bg.png", alt: "Red gemstone necklace from La Palme d’Or Gems imagery" }}>
      <p>Since 1973, La Palme d&apos;Or has served generations of clients through private commissions, natural stones, and carefully finished jewelry.</p>
    </EditorialHero>
    <EditorialSection eyebrow="Egyptian jewelry heritage" title="Since 1973." light>
      <p className={styles.year} aria-hidden="true">1973</p>
      <p>The maison’s story is rooted in Egypt and in the relationship between a piece and the person who wears it. Its established tradition is one of private jewelry commissions and personal design conversations.</p>
    </EditorialSection>
    <EditorialSection eyebrow="A considered point of view" title="Natural stones, composed with restraint.">
      <div className={styles.cards}>
        <article><h3>The character of a stone</h3><p>Colour and proportion offer the beginning of a composition. Explore <Link href="/gemstones">the gemstone guide</Link> to understand the questions worth asking about a particular stone.</p></article>
        <article><h3>The purpose of a piece</h3><p>Pendants shaped around personal meaning. Earrings balanced for light and movement. Rings designed around colour and proportion.</p></article>
        <article><h3>Attention to detail</h3><p>A setting, a line, a balance of elements: these details shape the design conversation. Requirements are considered for the individual piece.</p></article>
        <article><h3>A bespoke tradition</h3><p>Every commission begins as an idea. The <Link href="/bespoke">four-step bespoke journey</Link> introduces the conversation from an initial vision to a finished jewel.</p></article>
      </div>
    </EditorialSection>
    <EditorialCTA title="A personal introduction to the maison."><p>Discover the collection and the possibilities of a piece shaped around your point of view.</p></EditorialCTA>
  </>;
}
