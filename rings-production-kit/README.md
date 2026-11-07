# La Palme d'Or Rings — production asset kit

Source: user-supplied `rings1.zip`.

- **20 images**: 13 editorial/satin images and 7 transparent ring-set cutouts.
- Optimized WebP derivatives retain original dimensions and transparency (where present), with no resizing, cropping, recoloring or generative alteration.
- Original size: **10.22 MiB**; optimized size: **2.41 MiB**.
- Directory `public/images/rings/` is intended to be copied into the Next.js repository unchanged. This kit has not modified any local or hosted website.

## Suggested design use

- Category hero: `editorial/royal-blue-center-stone-ring-satin.webp` (R03), paired with an editorial introduction.
- Secondary features: R01 butterfly, R06 pink stone, R10 teal center, R12 open two-stone.
- Ring-set feature: R19 stacked floral.
- R13–R18 transparent cutouts can be used as editorial accents only, with adequate padding and appropriately contrasting backgrounds. Small sizes (~500–655 px) are not recommended for fullscreen zoom.
- R20 has limited source resolution (619×384) and should be used small or omitted from hero layouts.

## Important catalogue separation

The uploaded archive contains image names referencing generation/screenshot workflows. Do not assert that any image is a photograph of real merchandise or claim verified metal, stone, certification, availability, weight, exact color/shape, or price from appearance alone.

- Editorial placements may use these illustrations without creating inventory.
- Actual product cards must continue to derive from published DB-backed products and the existing Cloudinary media system; do not turn these images into fake product entries.
- Linking one of these images to an actual product requires a positive confirmation that the image represents that exact offered piece.
- Keep `Price on Request`; purchase flow remains disabled under central quotation policy.

## Integration guidance

Use the current dynamic category route `/collections/[category]` for the `rings` category. Do not add a separate `/rings` page or alternate catalogue. Avoid duplicating production derivatives in Cloudinary unless the client explicitly approves linking them as actual product media. Include all files in Git/release artifact.

No active deployment or Cloudinary upload was performed when preparing this kit.
