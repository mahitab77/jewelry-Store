import Image from "next/image";
import Link from "next/link";
import { EditorialCTA, EditorialHero, EditorialSection } from "../../../components/editorial/Editorial";
import { catalogueMetadata } from "../../../lib/catalogue/storefront.ts";
import styles from "../../../components/editorial/editorial.module.css";

export const metadata = catalogueMetadata("A Guide to Gemstones", "An introduction to emeralds, rubies, sapphires and diamonds, with considered guidance on characteristics, treatments and documentation.", "/gemstones", false);

const stones = [
  { name: "Emeralds", image: "earrings-emerald-no-bg.png", alt: "Green gemstone earrings illustrating an emerald colour palette",
    text: "Emerald is the green to bluish-green variety of beryl. Visible inclusions are common; colour, transparency, fractures and any clarity treatment should be considered together.", source: "https://www.gia.edu/emerald" },
  { name: "Rubies", image: "ruby-earring-no-bg.png", alt: "Red gemstone earring illustrating a ruby colour palette",
    text: "Ruby is the red variety of corundum. Its colour is associated with chromium. The appearance of an individual stone should be considered alongside its treatment information, not colour alone.", source: "https://www.gia.edu/ruby" },
  { name: "Sapphires", image: "yellow-sapphire-ring-no-bg.png", alt: "Yellow gemstone ring illustrating the colour range associated with sapphire",
    text: "Sapphire belongs to the corundum family. Beyond blue, sapphires occur in colours including yellow, pink and green; red corundum is classified as ruby.", source: "https://www.gia.edu/sapphire" },
  { name: "Diamonds", image: "dimanond-ring-no-bg.png", alt: "Colourless-stone ring design illustrating a diamond jewelry composition",
    text: "Diamond is a crystalline form of carbon. Colour, clarity, cut and carat weight describe different aspects of an individual diamond; no single characteristic tells the whole story.", source: "https://www.gia.edu/diamond" },
];

export default function GemstonesPage() {
  return <>
    <EditorialHero eyebrow="The language of stones" title="Colour, light, and individual character."><p>A gemstone is more than a name. Understanding its characteristics, treatment history and available documentation helps you ask thoughtful questions about a particular piece.</p></EditorialHero>
    <EditorialSection eyebrow="Four starting points" title="A world of natural colour." light>
      <div className={styles.gemGrid}>{stones.map((stone) => <article className={styles.gemCard} key={stone.name}>
        <div className={styles.gemImage}><Image src={`/images/${stone.image}`} alt={stone.alt} fill sizes="(max-width: 639px) 86vw, 500px" className={styles.image} /></div>
        <h3>{stone.name}</h3><p>{stone.text}</p><a className={styles.source} href={stone.source}>Gemstone education: GIA</a>
      </article>)}</div>
      <p className="mt-8">These images illustrate jewelry and colour. They do not establish the identity, origin, treatment or certification of an individual stone.</p>
    </EditorialSection>
    <EditorialSection eyebrow="Look a little closer" title="The questions behind the beauty.">
      <div className={styles.cards}>
        <article><h3>Colour & cut</h3><p>Consider the hue and how colour appears across the stone. Cut and proportions influence its appearance; shape alone is not a quality grade.</p></article>
        <article><h3>Clarity & carat weight</h3><p>Inclusions are part of a stone’s individual characteristics. Carat is a measure of weight, not a promise of identical visible size or appearance.</p></article>
        <article><h3>Documented origin</h3><p>Ask what evidence is available for an origin statement. Colour alone does not establish a geographic source, and an educational description is not provenance for a jewel.</p></article>
        <article><h3>Treatments & reports</h3><p>Treatments can affect appearance and care. Ask about the individual stone and any available laboratory report. Report availability and scope vary; no universal certification is implied.</p></article>
      </div>
      <nav className={styles.reading} aria-label="Gemstone reading"><a href="https://www.gia.edu/diamond-quality-factor">GIA: diamond quality factors</a><a href="https://www.gia.edu/emerald-quality-factor">GIA: emerald quality factors</a></nav>
    </EditorialSection>
    <EditorialCTA title="See the stones in context." href="/collections" label="Explore the collections"><p>Explore the published selection, or begin with a private appointment conversation.</p><Link href="/appointment">Private appointments</Link></EditorialCTA>
  </>;
}
