import Link from "next/link";
import { connection } from "next/server";
import { loadJewel } from "../../lib/catalogue/storefront.ts";
import type { RequestKind } from "../../lib/requests/types.ts";
import { RequestForm, type RequestProduct } from "./RequestForm";
import styles from "./request.module.css";

export type RequestQuery = Record<string,string | string[] | undefined>;
export async function RequestEntry({ searchParams, consultation = false }: { searchParams: Promise<RequestQuery>; consultation?: boolean }) {
  await connection();
  const query = await searchParams;
  const allowed = ["intent","product","variant"], validKeys = Object.keys(query).every((key) => allowed.includes(key) && typeof query[key] === "string");
  const intent = consultation ? "CONSULTATION" : query.intent || (query.product ? "QUOTATION" : "BESPOKE");
  if (!validKeys || typeof intent !== "string" || !["QUOTATION","MODIFICATION","BESPOKE","CONSULTATION"].includes(intent)) return <section className={styles.root}><p role="alert">This request link is not valid. Please choose a piece from the collections or start a new conversation below.</p><Link href="/contact">Start a conversation</Link></section>;
  let product: RequestProduct | undefined;
  if (query.product) {
    const result = await loadJewel(query.product as string);
    if (result.state !== "ready" || !result.value.variants.length || query.variant && !result.value.variants.some((variant) => variant.id === query.variant)) return <section className={styles.root}><p role="alert">This piece or configuration is not available for a new request. Please choose a currently published piece.</p><Link href="/collections">Explore the collections</Link></section>;
    product = result.value;
  }
  if (!product && (intent === "QUOTATION" || intent === "MODIFICATION" || query.variant)) return <section className={styles.root}><p role="alert">Choose the piece and configuration you would like to discuss from its product page.</p><Link href="/collections">Explore the collections</Link></section>;
  return <RequestForm key={`${product?.id || "general"}:${intent}:${query.variant || ""}`} product={product} initialKind={intent as RequestKind} initialVariant={typeof query.variant === "string" ? query.variant : undefined} consultation={consultation} />;
}
