"use client";
import Link from "next/link";
import { useState } from "react";
import type { CartItem } from "../../lib/cart/types.ts";
import { formatEgp } from "../../lib/catalogue/presentation.ts";
import { ProductPhoto } from "../catalogue/ProductPhoto";
import { changeCart, refreshCart, useCart } from "./cart-store";
import styles from "./cart.module.css";

const money = (amount: string | null) => amount === null ? "Unavailable" : formatEgp({ currency: "EGP", amountMinor: amount });
function Selection({ item, disabled, change, remove }: { item: CartItem; disabled: boolean; change: (quantity: number) => void; remove: () => void }) {
  return <article className={styles.item} aria-label={item.name}>
    <div className={styles.photo}>{item.image ? <ProductPhoto src={item.image.source} alt={item.image.alt} fill sizes="(max-width:767px) 88px,140px" className={styles.image} /> : <span>Photograph unavailable</span>}</div>
    <div><h2 className="font-display">{item.href ? <Link href={item.href}>{item.name}</Link> : item.name}</h2>
      {item.configuration ? <p className={styles.detail}>{item.configuration}</p> : null}
      <p className={styles.price}>Unit price: {money(item.unitPriceMinor)}</p><p className={styles.price}>Line total: {money(item.lineTotalMinor)}</p>
      {item.notice ? <p className={styles.notice}>{item.notice}</p> : null}
      {item.priceChanged ? <p className={styles.priceNotice}>The price has changed since this piece was added to your bag.</p> : null}
      <div className={styles.controls}><div className={styles.quantity} role="group" aria-label={`Quantity for ${item.name}`}>
        <button type="button" disabled={disabled || item.quantity <= 1 || item.maxQuantity < 1} aria-label={`Decrease quantity for ${item.name}`} onClick={() => change(Math.min(item.quantity - 1, item.maxQuantity))}>−</button>
        <input type="number" aria-label={`Quantity for ${item.name}`} min="1" max={Math.max(1, item.maxQuantity)} step="1" value={item.quantity}
          disabled={disabled || item.maxQuantity < 1} onChange={(event) => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= 1 && next <= item.maxQuantity && next !== item.quantity) change(next); }} />
        <button type="button" disabled={disabled || item.quantity >= item.maxQuantity} aria-label={`Increase quantity for ${item.name}`} onClick={() => change(item.quantity + 1)}>+</button>
      </div><button type="button" className={styles.remove} disabled={disabled} onClick={remove} aria-label={`Remove ${item.name}`}>Remove</button></div>
    </div>
  </article>;
}
export function CartContents() {
  const { cart, loading, pending, error } = useCart();
  const [feedback, setFeedback] = useState(""), [failed, setFailed] = useState(false);
  async function change(itemId: string, quantity?: number) {
    if (!cart?.revision) return;
    setFeedback(""); setFailed(false);
    try { setFeedback(await changeCart(quantity === undefined ? "DELETE" : "PATCH", `items/${itemId}`, { revision: cart.revision, ...(quantity === undefined ? {} : { quantity }) })); }
    catch (reason) { setFailed(true); setFeedback((reason as Error).message); }
  }
  return <section className={`maison-container ${styles.root}`}>
    <p className={styles.eyebrow}>A considered selection</p><h1 className="font-display">Your shopping bag</h1>
    <p className={styles.intro}>Keep the pieces that speak to you. Your bag is saved for thirty days on this browser. Pieces are not reserved, and prices and availability may change.</p>
    {error ? <div className={styles.notice} role="alert"><p>{error}{cart?.items.length ? " Previously loaded selections are shown below." : ""}</p><button type="button" className={`hero-cta hero-secondary-button ${styles.button}`} disabled={loading || pending} onClick={() => void refreshCart()}>Refresh bag</button></div> : null}
    {feedback ? <p className={styles.feedback} role={failed ? "alert" : "status"}>{feedback}</p> : null}
    {!cart ? loading ? <p role="status">Opening your shopping bag…</p> : null : <>
      {cart.expired ? <p className={styles.notice}>Your previous shopping bag is no longer active. Add a piece to begin a new selection.</p> : null}
      {cart.items.length ? <div className={styles.layout}>
        <div>{cart.items.map((item) => <Selection key={item.id} item={item} disabled={pending || loading || Boolean(error)} change={(quantity) => void change(item.id, quantity)} remove={() => void change(item.id)} />)}
          <Link href="/collections" className={`hero-cta hero-secondary-button ${styles.button}`}>Continue shopping</Link></div>
        <aside className={styles.summary} aria-label="Shopping bag summary"><h2 className="font-display">Your selection</h2>
          <div className={styles.subtotal}><span>Subtotal</span><strong data-cart-subtotal>{money(cart.subtotalMinor)}</strong></div>
          <p className={styles.detail}>An estimate at current EGP prices. The final total will be confirmed when checkout is available.</p>
          {!cart.eligible ? <p className={styles.notice}>Please review your selection before purchasing. Your choices remain in the bag until you remove them.</p> : null}
          <p className={styles.detail}>Online checkout is not available yet.</p><button type="button" disabled className={`hero-cta hero-primary-button ${styles.button}`}>Checkout unavailable</button>
        </aside>
      </div> : <div className={styles.empty}><h2 className="font-display">Your bag is waiting</h2><p>Explore our jewelry and return here with the pieces you would like to keep in mind.</p><Link href="/collections" className={`hero-cta hero-primary-button ${styles.button}`}>Explore the collections</Link></div>}
    </>}
  </section>;
}
