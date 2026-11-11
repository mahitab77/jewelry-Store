"use client";
import Link from "next/link";
import { useState } from "react";
import { useCustomer } from "./CustomerSessionProvider";
import styles from "./customer.module.css";
export function CustomerAccountMenu() {
  const { customer, signOut } = useCustomer(), [open, setOpen] = useState(false), [error, setError] = useState(false);
  return <div className={styles.menu} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} onKeyDown={e => { if (e.key === "Escape") { setOpen(false); e.currentTarget.querySelector("button")?.focus(); } }}>
    {customer ? <><button type="button" className={styles.accountButton} aria-label="My Account menu" aria-expanded={open} onClick={() => setOpen(!open)}>Account</button>
      {open ? <div className={styles.panel}><Link href="/account" onClick={() => setOpen(false)}>My Account</Link><button type="button" onClick={async () => { setOpen(false); if (await signOut()) window.location.replace("/account/sign-in"); else setError(true); }}>Sign Out</button></div> : null}</>
      : <Link className={styles.accountButton} href="/account/sign-in" aria-label="Sign In to your account">Sign In</Link>}
    {error ? <p role="alert" className={styles.panel}>Sign-out was not confirmed. <button onClick={async () => { if (await signOut()) window.location.replace("/account/sign-in"); }}>Retry Sign Out</button></p> : null}
  </div>;
}
