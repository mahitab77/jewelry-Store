import Image from "next/image";
import Link from "next/link";
import { BespokeProcessCarousel } from "../../../components/BespokeProcessCarousel";
import { EditorialCTA, EditorialHero, EditorialSection } from "../../../components/editorial/Editorial";
import { catalogueMetadata } from "../../../lib/catalogue/storefront.ts";
import styles from "../../../components/editorial/editorial.module.css";

export const metadata = catalogueMetadata("Bespoke Jewelry", "From a personal vision to a finished jewel. Explore the bespoke design conversation at La Palme d’Or Gems.", "/bespoke", false);

export default function BespokePage() {
  return <>
    <EditorialHero eyebrow="Private commissions" title="From your vision, a personal heirloom."
      image={{ src: "/images/soft-necklace-no-bg.png", alt: "Gemstone necklace design by La Palme d’Or Gems" }}>
      <p>Every commission begins with a conversation. Meet a designer, shape your idea, refine the details, choose your stones, and watch your piece come to life.</p>
    </EditorialHero>
    <div className="lp-transition lp-transition-black-to-cream" aria-hidden="true" />
    <BespokeProcessCarousel appointmentHref="/appointment" />
    <div className="lp-transition lp-transition-cream-to-black" aria-hidden="true" />
    <EditorialSection eyebrow="Atelier craft" title="Considered from the first line.">
      <div className={styles.split}><div><p>A pendant with personal meaning. A ring defined by colour and proportion. Earrings balanced for light and movement. The starting point belongs to you.</p>
        <p>Proportion, setting, metal and the way a piece will be worn are part of the design conversation. Details, feasibility and arrangements should be agreed for the individual commission.</p>
        <p className={styles.caption}>A design illustration: specifications are considered for each piece.</p></div>
        <figure><Image src="/images/designer-sketch-1.png" alt="Illustrative earring design sheet with proportions and stone placement" fill sizes="(max-width: 899px) 90vw, 540px" className={styles.image} /></figure>
      </div>
    </EditorialSection>
    <EditorialSection eyebrow="Colour and character" title="Begin with the stone." light>
      <p>Emeralds, rubies, sapphires and diamonds offer different starting points for a design. Discuss the colour, shape and character you are drawn to, together with the information available for the individual stone.</p>
      <p><Link href="/gemstones">Explore the gemstone guide</Link> before your conversation.</p>
    </EditorialSection>
    <EditorialSection eyebrow="A few first questions" title="Before the conversation.">
      <div className={styles.faq}>
        <details><summary>Can I begin with a sketch or a reference?</summary><p>Yes. The existing bespoke journey begins with your idea: a rough sketch, a saved inspiration or a personal concept can be a starting point for discussion.</p></details>
        <details><summary>Can I discuss the stone and setting?</summary><p>Share your preferences for colour, shape, metal and proportion. The options for your individual piece should be discussed with the boutique.</p></details>
        <details><summary>How long will a commission take?</summary><p>Please discuss timing with the boutique for your individual commission. The design and its requirements need to be considered first.</p></details>
        <details><summary>How do I begin?</summary><p>Visit <Link href="/appointment">Private Appointments</Link> for the conversation topics and current enquiry availability. No appointment is confirmed by browsing the site.</p></details>
      </div>
    </EditorialSection>
    <EditorialCTA title="Begin your bespoke journey." label="Explore private appointments"><p>Bring a first idea, a colour, or a story you would like a piece to hold.</p></EditorialCTA>
  </>;
}
