"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./admin.module.css";

export function AdminLoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (passwordRef.current) passwordRef.current.value = "";
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/admin-auth/sign-in/email", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: fields.get("email"), password: fields.get("password") }) });
      if (response.ok) { router.replace("/admin"); router.refresh(); return; }
      setError(response.status === 429 ? "Too many attempts. Please wait before trying again."
        : response.status === 503 ? "Sign-in is temporarily unavailable. Please try again later."
          : "Sign-in was unsuccessful. Check your details or try again later.");
    } catch { setError("Sign-in is temporarily unavailable. Please try again later."); }
    setPending(false);
    requestAnimationFrame(() => errorRef.current?.focus());
  }
  return <form method="post" action="/api/admin-auth/sign-in/email" className={styles.form} onSubmit={submit} aria-busy={pending}>
    <label htmlFor="admin-email">Email address</label>
    <input id="admin-email" name="email" type="email" autoComplete="username" required maxLength={254} aria-describedby={error ? "admin-login-error" : undefined} />
    <label htmlFor="admin-password">Password</label>
    <input ref={passwordRef} id="admin-password" name="password" type="password" autoComplete="current-password" required maxLength={128} aria-describedby={error ? "admin-login-error" : undefined} />
    {error ? <p id="admin-login-error" ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>{error}</p> : null}
    <button type="submit" disabled={pending} className={`hero-cta hero-primary-button ${styles.button}`}>{pending ? "Signing in…" : "Sign in"}</button>
  </form>;
}
