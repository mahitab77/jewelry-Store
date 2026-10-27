"use client";

import Image from "next/image";
import { useState } from "react";
import type { PublicMedia } from "../../lib/catalogue/types.ts";
import { publicImageSource } from "../../lib/catalogue/presentation.ts";
import styles from "./catalogue.module.css";

export function JewelryGallery({ media, name }: { media: PublicMedia[]; name: string }) {
  const photos = media.filter((item) => publicImageSource(item));
  const [index, setIndex] = useState(0);
  const selected = photos[index];
  const source = selected ? publicImageSource(selected) : null;
  return <section aria-label="Jewelry photographs" className={styles.gallery}>
    <div className={`royal-frame ${styles.galleryStage}`}>
      {source ? <Image key={selected.id} src={source} alt={selected.altText?.trim() || `${name}, photograph ${index + 1}`} fill preload={index === 0}
        sizes="(max-width: 899px) 92vw, 650px" className={styles.jewelImage} />
        : <div className={styles.imagePlaceholder}><p className="font-display">A private view.</p><p>Photography is available by contacting the boutique.</p></div>}
    </div>
    {photos.length > 1 ? <>
      <div className={styles.galleryControls}>
        <button type="button" onClick={() => setIndex((index + photos.length - 1) % photos.length)} aria-label="Previous photograph">←</button>
        <p aria-live="polite" aria-atomic="true">Photograph {index + 1} of {photos.length}</p>
        <button type="button" onClick={() => setIndex((index + 1) % photos.length)} aria-label="Next photograph">→</button>
      </div>
      <div className={styles.thumbnails} aria-label="Choose a photograph">{photos.map((photo, i) => <button key={photo.id} type="button"
        aria-label={`Show photograph ${i + 1}`} aria-pressed={index === i} onClick={() => setIndex(i)}>
        <Image src={publicImageSource(photo)!} alt="" width={80} height={80} className={styles.jewelImage} />
      </button>)}</div>
    </> : null}
  </section>;
}
