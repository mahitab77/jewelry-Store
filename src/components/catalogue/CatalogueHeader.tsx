"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { primaryNavigation } from "@/lib/navigation";
import styles from "./catalogue.module.css";
import { CartBag } from "../cart/CartBag";

export function CatalogueHeader() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); }
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", closeOnEscape);
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, [open]);
  return <header className="site-header sticky top-0 z-50 border-b border-(--border) bg-[rgba(9,8,7,0.78)] backdrop-blur-xl">
    <nav className="maison-container flex min-h-16 items-center justify-between gap-4 py-3 sm:min-h-20 sm:gap-6 sm:py-4" aria-label="Primary navigation">
      <Link href="/" className="flex min-w-0 items-center gap-3 sm:gap-4" aria-label="Home">
        <span className="brand-medallion shrink-0"><Image src="/images/logo-la-palme-dor-no-bg.png" alt="La Palme d'Or Gems logo" width={128} height={84} className="h-16 w-auto object-contain sm:h-20" /></span>
        <span className="navbar-brand-text font-display hidden truncate text-ivory lg:inline">La Palme d&apos;Or Gems</span>
      </Link>
      <div className="hidden items-center gap-1 text-[0.82rem] uppercase tracking-[0.18em] text-[rgba(229,213,189,0.78)] lg:mr-7 lg:flex xl:gap-5">
        {primaryNavigation.map((link) => <Link key={link.href} href={link.href} className="nav-link shrink-0 transition-colors duration-300 hover:text-gold">{link.label}</Link>)}
      </div>
      <div className="relative flex shrink-0 items-center gap-2 sm:gap-3">
        <CartBag />
        <button ref={toggle} type="button" className={`nav-menu-button lg:hidden ${styles.menuButton}`} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          <span aria-hidden="true" className={styles.menuBar} /><span aria-hidden="true" className={styles.menuBar} /><span aria-hidden="true" className={styles.menuBar} />
        </button>
        <Link href="/appointment" onClick={() => setOpen(false)} className="navbar-cta inline-flex min-h-10 items-center justify-center px-3.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] sm:min-h-11 sm:px-5 sm:text-xs sm:tracking-[0.18em]">
          <span className="sm:hidden">Book</span><span className="hidden sm:inline">Book Appointment</span>
        </Link>
      </div>
    </nav>
    {open ? <nav id={panelId} aria-label="Site sections" className={styles.mobilePanel}>
      <div className="maison-container">{primaryNavigation.map((link) => <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}</div>
    </nav> : <div id={panelId} hidden />}
  </header>;
}
