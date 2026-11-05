import { EditorialHero, EditorialSection } from "../../../components/editorial/Editorial";
import { ContactOptions } from "../../../components/editorial/ContactOptions";
import { catalogueMetadata } from "../../../lib/catalogue/storefront.ts";
import styles from "../../../components/editorial/editorial.module.css";
import { RequestEntry, type RequestQuery } from "../../../components/requests/RequestEntry";

export const metadata = catalogueMetadata("Private Appointments", "Prepare for a personal jewelry conversation: collection viewing, bespoke ideas, gemstones and care enquiries. Check current contact availability.", "/appointment", false);

export default function AppointmentPage({ searchParams }: { searchParams: Promise<RequestQuery> }) {
  return <>
    <EditorialHero eyebrow="Private appointments" title="A conversation, shaped around you."
      image={{ src: "/images/soft-necklace-no-bg.png", alt: "Gemstone necklace composition by La Palme d’Or Gems" }}>
      <p>Begin with what matters to you: a piece you would like to see, an idea for a commission, or a question about a stone. Personal arrangements require confirmation from the boutique.</p>
    </EditorialHero>
    <div className="maison-container"><RequestEntry searchParams={searchParams} consultation /><ContactOptions appointment /></div>
    <EditorialSection eyebrow="Ideas for a conversation" title="What would you like to explore?" light>
      <p>These are possible conversation topics, not confirmed bookings or a promise of service availability.</p>
      <div className={styles.cards}>
        <article><h3>Explore the collection</h3><p>Bring a reference to a published piece and the questions you would like to discuss.</p></article>
        <article><h3>A bespoke commission</h3><p>A sketch, inspiration or personal concept can introduce the design conversation.</p></article>
        <article><h3>Gemstone consultation</h3><p>Consider colour, shape and the documentation you would like to understand.</p></article>
        <article><h3>A jewelry care enquiry</h3><p>Describe the piece and your concern. Any assessment or service needs confirmation.</p></article>
        <article><h3>A private viewing</h3><p>Ask about a piece you would like to see. The available selection and arrangements must be confirmed personally.</p></article>
      </div>
    </EditorialSection>
    <EditorialSection eyebrow="Before making arrangements" title="A request begins the conversation.">
      <p>No date or time is reserved by viewing this page. Please wait for a verified contact channel and personal confirmation before making plans around a visit.</p>
    </EditorialSection>
  </>;
}
