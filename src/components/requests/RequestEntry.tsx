import Link from "next/link";
import { connection } from "next/server";
import { loadJewel } from "../../lib/catalogue/storefront.ts";
import type { RequestKind } from "../../lib/requests/types.ts";
import { RequestForm, type RequestProduct } from "./RequestForm";
import styles from "./request.module.css";
import { CustomerGate } from "../customer/CustomerSessionProvider";
import { customerReturn } from "../../lib/customer/intent";
import { variantOptionLabels } from "../../lib/catalogue/presentation.ts";

export type RequestQuery = Record<string,string | string[] | undefined>;
export async function RequestEntry({ searchParams, consultation = false }: { searchParams: Promise<RequestQuery>; consultation?: boolean }) {
  await connection();
  const query = await searchParams;
  // Only these parameters describe the request. Campaign and referral parameters
  // belong to their callers, and may contain repeated values of their own.
  const validOwnedValues = ["intent", "product", "variant", "channel"].every((key) => query[key] === undefined || typeof query[key] === "string" && query[key].trim().length > 0);
  const validIntent = query.intent === undefined || typeof query.intent === "string" && ["QUOTATION", "MODIFICATION", "BESPOKE", "CONSULTATION"].includes(query.intent);
  const intent = consultation ? "CONSULTATION" : query.intent || (query.product ? "QUOTATION" : "BESPOKE");
  const validChannel = query.channel === undefined || intent === "CONSULTATION" && ["ZOOM", "BOUTIQUE"].includes(query.channel as string);
  if (!validOwnedValues || !validIntent || !validChannel || typeof intent !== "string") return <section className={styles.root}><p role="alert">This request link is not valid. Please choose a piece from the collections or start a new conversation below.</p><Link href="/contact">Start a conversation</Link></section>;
  let product: RequestProduct | undefined;
  if (query.product) {
    const result = await loadJewel(query.product as string);
    if (result.state !== "ready" || !result.value.variants.length || query.variant && !result.value.variants.some((variant) => variant.id === query.variant)) return <section className={styles.root}><p role="alert">This piece or configuration is not available for a new request. Please choose a currently published piece.</p><Link href="/collections">Explore the collections</Link></section>;
    product = result.value;
  }
  if (!product && (intent === "QUOTATION" || intent === "MODIFICATION" || query.variant)) return <section className={styles.root}><p role="alert">Choose the piece and configuration you would like to discuss from its product page.</p><Link href="/collections">Explore the collections</Link></section>;
  const channel = query.channel === "BOUTIQUE" ? "BOUTIQUE" : "ZOOM";
  const draftKey = `${consultation ? "appointment" : "contact"}:${product?.id || "general"}:${intent}:${query.variant || ""}:${intent === "CONSULTATION" ? channel : ""}`;
  const params = new URLSearchParams({ intent, ...(product ? { product: product.slug } : {}), ...(typeof query.variant === "string" ? { variant: query.variant } : {}), ...(intent === "CONSULTATION" ? { channel } : {}) });
  const variantIndex = product ? Math.max(0, product.variants.findIndex(variant => variant.id === query.variant)) : 0;
  const context = product ? <div className={styles.context}><p>Selected piece: <Link href={`/jewels/${product.slug}`}>{product.name}</Link></p><p>Selected configuration: {variantOptionLabels(product.variants)[variantIndex].accessible}</p></div> : undefined;
  return <CustomerGate context={context} returnTo={customerReturn(`${consultation ? "/appointment" : "/contact"}?${params}`)}><RequestForm key={draftKey} draftKey={draftKey} product={product} initialKind={intent as RequestKind} initialVariant={typeof query.variant === "string" ? query.variant : undefined} initialChannel={channel} consultation={consultation} /></CustomerGate>;
}
