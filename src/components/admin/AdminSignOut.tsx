"use client";

import { useState } from "react";
import styles from "./admin.module.css";

export function AdminSignOut() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function signOut() {
    setPending(true); setError(false);
    try {
      const response = await fetch("/admin/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (response.ok) { window.location.replace("/admin/login"); return; }
    } catch { /* Keep a visible retry state without exposing internals. */ }
    setError(true); setPending(false);
  }
  return <div><button type="button" onClick={signOut} disabled={pending} className={`hero-cta hero-secondary-button ${styles.button}`}>{pending ? "Signing out…" : "Sign out"}</button>
    {error ? <p role="alert">Sign-out could not be completed. Please try again.</p> : null}</div>;
}
