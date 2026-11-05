"use client";

import Link from "next/link";
import { useState } from "react";
import type { PublicProductDetail } from "../../lib/catalogue/types.ts";
import { formatEgp, variantOptionLabels } from "../../lib/catalogue/presentation.ts";
import styles from "./catalogue.module.css";
import { AddToCart } from "../cart/AddToCart";

type Props = Pick<PublicProductDetail, "id" | "slug" | "variants" | "productType" | "salesMode" | "canEnquire">;
export function JewelryOptions({ slug, variants, productType, salesMode, canEnquire }: Props) {
  const [selectedId, setSelectedId] = useState(() => (variants.find((v) => v.canPurchase) ?? variants[0])?.id);
  const selected = variants.find((v) => v.id === selectedId);
  const labels = variantOptionLabels(variants);
  const enquiryOnly = productType === "BESPOKE" || salesMode === "ENQUIRY_ONLY";
  const requestHref = (intent: "QUOTATION" | "MODIFICATION" | "CONSULTATION") => `${intent === "CONSULTATION" ? "/appointment" : "/contact"}?${new URLSearchParams({ intent, product: slug, ...(selected ? { variant: selected.id } : {}) }).toString()}`;
  const availability = enquiryOnly ? "By private enquiry" : selected?.availability === "OUT_OF_STOCK" ? "Currently unavailable"
    : selected?.canPurchase ? "Available to purchase" : "Availability on request";
  return <div>
    <p className={styles.detailPrice} aria-live="polite">{formatEgp(selected?.price ?? null)}</p>
    {variants.length > 1 ? <fieldset className={styles.options}><legend>Choose a configuration</legend>
      {variants.map((variant, i) => <label key={variant.id}>
        <input type="radio" name="jewelry-variant" value={variant.id} checked={selectedId === variant.id} onChange={() => setSelectedId(variant.id)}
          aria-label={`${labels[i].accessible} · ${formatEgp(variant.price)}${variant.availability === "OUT_OF_STOCK" ? " · Currently unavailable" : ""}`} />
        <span>{labels[i].visible}
          <small>{formatEgp(variant.price)}{variant.availability === "OUT_OF_STOCK" ? " · Currently unavailable" : ""}</small></span>
      </label>)}
    </fieldset> : null}
    <p className={styles.stock} aria-live="polite">{availability}</p>
    <p className={styles.supporting}>{selected?.canPurchase
      ? "Add your chosen configuration to the shopping bag. Your bag does not reserve the piece."
      : enquiryOnly ? "A private conversation is the first step. Speak with us about the piece, its details, and your preferences."
        : "Our boutique can share further details. Availability is confirmed personally."}</p>
    {selected?.canPurchase && !enquiryOnly ? <AddToCart key={selected.id} variantId={selected.id} /> : null}
    {canEnquire || selected?.canPurchase ? <><Link href={requestHref("QUOTATION")}
      className={`hero-cta hero-primary-button ${styles.button}`}>
      Request a Quotation
    </Link><div><Link href={requestHref("MODIFICATION")} className={`hero-cta hero-secondary-button ${styles.button}`}>Request Changes</Link></div><div><Link href={requestHref("CONSULTATION")} className={`hero-cta hero-secondary-button ${styles.button}`}>Consult the Designer</Link></div></> : <Link href="/collections" className={`hero-cta hero-secondary-button ${styles.button}`}>Explore the collections</Link>}
    {selected ? <>
      <dl className={styles.specifications}>
        {selected.metalType || selected.metalPurity || selected.metalColor ? <div><dt>Metal</dt><dd>{[selected.metalType, selected.metalPurity, selected.metalColor].filter(Boolean).join(" · ")}</dd></div> : null}
        {selected.metalWeightGrams ? <div><dt>Metal weight</dt><dd>{selected.metalWeightGrams.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")} g ({selected.metalWeightBasis === "ACTUAL" ? "actual" : "estimated"})</dd></div> : null}
        {selected.size ? <div><dt>Size</dt><dd>{selected.size}</dd></div> : null}
        {selected.configuration ? <div><dt>Configuration</dt><dd>{selected.configuration}</dd></div> : null}
        <div><dt>Reference</dt><dd>{selected.sku}</dd></div>
      </dl>
      {selected.gemstones.length ? <section className={styles.stones} aria-label="Gemstone specifications">
        <h2 className="font-display">The stones</h2>
        {selected.gemstones.map((stone, i) => <div key={i}>
          <h3>{stone.type}{stone.variety ? ` · ${stone.variety}` : ""}</h3>
          <p>{[stone.shape, stone.color, `${stone.quantity} ${stone.role.toLowerCase()} ${stone.quantity === 1 ? "stone" : "stones"}`].join(" · ")}</p>
          {stone.caratWeight ? <p>{stone.caratWeight.replace(/0+$/, "").replace(/\.$/, "")} ct per stone</p> : null}
          {stone.totalCaratWeight ? <p>{stone.totalCaratWeight.replace(/0+$/, "").replace(/\.$/, "")} ct total</p> : null}
          {stone.treatmentInformation ? <p>Treatment: {stone.treatmentInformation}</p> : null}
        </div>)}
      </section> : null}
    </> : null}
  </div>;
}
