import Link from "next/link";
import { EditorialHero, EditorialSection } from "../../../components/editorial/Editorial";
import { ContactOptions } from "../../../components/editorial/ContactOptions";
import { catalogueMetadata } from "../../../lib/catalogue/storefront.ts";

export const metadata = catalogueMetadata("Contact the Maison", "Contact availability for La Palme d’Or Gems in Cairo, Egypt, and information for a personal jewelry or appointment conversation.", "/contact", false);

export default function ContactPage() {
  return <>
    <EditorialHero eyebrow="La Palme d’Or Gems · Cairo, Egypt" title="Speak with the maison."><p>For a collection question, a bespoke idea, or a conversation about a personal piece, find the current contact availability below.</p></EditorialHero>
    <div className="maison-container"><ContactOptions /></div>
    <EditorialSection eyebrow="While you explore" title="Find your starting point.">
      <p>Discover <Link href="/collections">the collections</Link>, understand <Link href="/gemstones">the gemstones</Link>, or explore <Link href="/bespoke">the bespoke journey</Link>.</p>
      <p>For conversation topics and what to expect, visit <Link href="/appointment">Private Appointments</Link>. Learn about the house on <Link href="/maison">The Maison</Link> and read <Link href="/services">Services & Care</Link> for general guidance.</p>
    </EditorialSection>
  </>;
}
