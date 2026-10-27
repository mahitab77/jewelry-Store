"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { changeCart, useCart } from "./cart-store";
import styles from "./cart.module.css";

export function AddToCart({ variantId }: { variantId: string }) {
  const { pending } = useCart();
  const inFlight = useRef(false);
  const [feedback, setFeedback] = useState(""), [failed, setFailed] = useState(false);
  async function add() {
    if (inFlight.current) return;
    inFlight.current = true;
    setFeedback(""); setFailed(false);
    try { setFeedback(await changeCart("POST", "items", { variantId, quantity: 1 })); }
    catch (error) { setFailed(true); setFeedback((error as Error).message); }
    finally { inFlight.current = false; }
  }
  return <div className={styles.purchase}>
    <button type="button" disabled={pending} className={`hero-cta hero-primary-button ${styles.button}`} onClick={() => void add()}>{pending ? "Updating bag…" : "Add to bag"}</button>
    {feedback ? <p className={styles.feedback} role={failed ? "alert" : "status"}>{feedback}{!failed ? <> <Link href="/cart">View your bag</Link></> : null}</p> : null}
  </div>;
}
