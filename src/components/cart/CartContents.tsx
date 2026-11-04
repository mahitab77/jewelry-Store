"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type { CartItem } from "../../lib/cart/types.ts";
import { formatEgp } from "../../lib/catalogue/presentation.ts";
import { ProductPhoto } from "../catalogue/ProductPhoto";
import { changeCart, refreshCart, useCart } from "./cart-store";
import styles from "./cart.module.css";

const money = (amount: string | null) => amount === null ? "Unavailable" : formatEgp({ currency: "EGP", amountMinor: amount });
function Selection({ item, disabled, change, remove }: { item: CartItem; disabled: boolean; change: (quantity: number) => Promise<void>; remove: () => void }) {
  const [edit, setEdit] = useState({ quantity: item.quantity, maximum: item.maxQuantity, value: String(item.quantity), error: "" });
  const committing = useRef(false);
  const current = edit.quantity === item.quantity && edit.maximum === item.maxQuantity;
  const value = current ? edit.value : String(item.quantity), error = current ? edit.error : "";
  const draftQuantity = Number(value), wholeDraft = /^\d+$/.test(value) && Number.isSafeInteger(draftQuantity) && draftQuantity >= 1;
  const hintId = `quantity-hint-${item.id}`, errorId = `quantity-error-${item.id}`;
  async function commit(proposed = value) {
    // Enter can cause blur as the pending controls become disabled. Lock before awaiting.
    if (disabled || committing.current || item.maxQuantity < 1) return;
    const next = Number(proposed);
    if (!/^\d+$/.test(proposed) || !Number.isSafeInteger(next) || next < 1 || next > item.maxQuantity) {
      setEdit({ quantity: item.quantity, maximum: item.maxQuantity, value: proposed, error: item.maxQuantity === 1 ? "This piece is limited to one. Enter 1." : `Enter a whole number from 1 to ${item.maxQuantity}.` });
      return;
    }
    setEdit({ quantity: item.quantity, maximum: item.maxQuantity, value: String(next), error: "" });
    if (next === item.quantity) return;
    committing.current = true;
    try { await change(next); }
    finally {
      // The server cart remains authoritative, including after a rejected or uncertain update.
      setEdit({ quantity: item.quantity, maximum: item.maxQuantity, value: String(item.quantity), error: "" });
      committing.current = false;
    }
  }
  return <article className={styles.item} aria-label={item.name}>
    <div className={styles.photo}>{item.image ? <ProductPhoto src={item.image.source} alt={item.image.alt} fill sizes="(max-width:767px) 88px,140px" className={styles.image} /> : <span>Photograph unavailable</span>}</div>
    <div><h2 className="font-display">{item.href ? <Link href={item.href}>{item.name}</Link> : item.name}</h2>
      {item.configuration ? <p className={styles.detail}>{item.configuration}</p> : null}
      <p className={styles.price}>Unit price: {money(item.unitPriceMinor)}</p><p className={styles.price}>Line total: {money(item.lineTotalMinor)}</p>
      {item.notice ? <p className={styles.notice}>{item.notice}</p> : null}
      {item.priceChanged ? <p className={styles.priceNotice}>The price has changed since this piece was added to your bag.</p> : null}
      <div className={styles.controls}><div className={styles.quantity} role="group" aria-label={`Quantity for ${item.name}`}>
        <button type="button" disabled={disabled || !wholeDraft || draftQuantity <= 1 || item.maxQuantity < 1} aria-label={`Decrease quantity for ${item.name}`} onPointerDown={(event) => event.preventDefault()} onClick={() => void commit(String(Math.min(draftQuantity - 1, item.maxQuantity)))}>−</button>
        <input type="number" inputMode="numeric" aria-label={`Quantity for ${item.name}`} min="1" max={Math.max(1, item.maxQuantity)} step="1" value={value}
          aria-invalid={Boolean(error)} aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`} disabled={disabled || item.maxQuantity < 1}
          onChange={(event) => setEdit({ quantity: item.quantity, maximum: item.maxQuantity, value: event.target.value, error: "" })}
          onBlur={() => void commit()} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commit(); } }} />
        <button type="button" disabled={disabled || !wholeDraft || draftQuantity >= item.maxQuantity} aria-label={`Increase quantity for ${item.name}`} onPointerDown={(event) => event.preventDefault()} onClick={() => void commit(String(draftQuantity + 1))}>+</button>
      </div><button type="button" className={styles.remove} disabled={disabled} onPointerDown={(event) => event.preventDefault()} onClick={remove} aria-label={`Remove ${item.name}`}>Remove</button></div>
      <p id={hintId} className={styles.quantityHint}>{item.maxQuantity === 1 ? "Limited to one piece." : item.maxQuantity > 1 ? `Up to ${item.maxQuantity} available. ` : "Currently unavailable. "} {item.maxQuantity > 0 ? "Press Enter or leave the field to update." : ""}</p>
      {error ? <p id={errorId} className={styles.quantityError} role="alert">{error}</p> : null}
    </div>
  </article>;
}
export function CartContents() {
  const { cart, loading, pending, error } = useCart();
  const [feedback, setFeedback] = useState(""), [failed, setFailed] = useState(false);
  const changing = useRef(false);
  async function change(itemId: string, quantity?: number) {
    if (!cart?.revision || pending || loading || error || changing.current) return;
    changing.current = true;
    setFeedback(""); setFailed(false);
    try { setFeedback(await changeCart(quantity === undefined ? "DELETE" : "PATCH", `items/${itemId}`, { revision: cart.revision, ...(quantity === undefined ? {} : { quantity }) })); }
    catch (reason) { setFailed(true); setFeedback((reason as Error).message); }
    finally { changing.current = false; }
  }
  return <section className={`maison-container ${styles.root}`}>
    <p className={styles.eyebrow}>A considered selection</p><h1 className="font-display">Your shopping bag</h1>
    <p className={styles.intro}>Keep the pieces that speak to you. Your bag is saved for thirty days on this browser. Pieces are not reserved, and prices and availability may change.</p>
    {error ? <div className={styles.notice} role="alert"><p>{error}{cart?.items.length ? " Previously loaded selections are shown below." : ""}</p><button type="button" className={`hero-cta hero-secondary-button ${styles.button}`} disabled={loading || pending} onClick={() => void refreshCart()}>Refresh bag</button></div> : null}
    {feedback ? <p className={styles.feedback} role={failed ? "alert" : "status"}>{feedback}</p> : null}
    <div className={styles.content} aria-busy={loading || pending}>{!cart ? loading ? <p role="status" className={styles.loading}>Opening your shopping bag…</p> : null : <>
      {cart.expired ? <p className={styles.notice}>Your previous shopping bag is no longer active. Add a piece to begin a new selection.</p> : null}
      {cart.items.length ? <div className={styles.layout}>
        <div>{cart.items.map((item) => <Selection key={item.id} item={item} disabled={pending || loading || Boolean(error)} change={(quantity) => change(item.id, quantity)} remove={() => void change(item.id)} />)}
          <Link href="/collections" className={`hero-cta hero-secondary-button ${styles.button}`}>Continue shopping</Link></div>
        <aside className={styles.summary} aria-label="Shopping bag summary"><h2 className="font-display">Your selection</h2>
          <div className={styles.subtotal}><span>Subtotal</span><strong data-cart-subtotal>{money(cart.subtotalMinor)}</strong></div>
          <p className={styles.detail}>An estimate at current EGP prices. Checkout preparation rechecks prices and availability; fulfillment charges are not yet confirmed.</p>
          {!cart.eligible ? <p className={styles.notice}>Please review your selection before purchasing. Your choices remain in the bag until you remove them.</p> : null}
          <p className={styles.detail}>Prepare your contact and fulfillment details. Online payment is not available yet.</p>{cart.eligible && !loading && !pending && !error ? <Link href="/checkout" prefetch={false} className={`hero-cta hero-primary-button ${styles.button}`}>Continue to checkout</Link> : <button type="button" disabled className={`hero-cta hero-primary-button ${styles.button}`}>Checkout unavailable</button>}
        </aside>
      </div> : <div className={styles.empty}><h2 className="font-display">Your bag is waiting</h2><p>Explore our jewelry and return here with the pieces you would like to keep in mind.</p><Link href="/collections" className={`hero-cta hero-primary-button ${styles.button}`}>Explore the collections</Link></div>}
    </>}</div>
  </section>;
}
