"use client";
import Link from "next/link";
import { useCart } from "./cart-store";
import styles from "./cart.module.css";

export function CartBag({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { cart, error } = useCart();
  return <Link href="/cart" onNavigate={onNavigate} data-cart-bag className={styles.bag}
    aria-label={error ? "Shopping bag, count unavailable" : cart ? `Shopping bag, ${cart.count} ${cart.count === 1 ? "item" : "items"}` : "Shopping bag"}>
    <svg width="23" height="25" viewBox="0 0 24 26" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M4.5 8.5h15l1 15h-17l1-15Z" /><path d="M8 10V6a4 4 0 0 1 8 0v4" /></svg>
    {cart && cart.count > 0 ? <span className={styles.badge} aria-hidden="true">{cart.count}</span> : null}
  </Link>;
}
