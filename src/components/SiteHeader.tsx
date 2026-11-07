"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { primaryNavigation } from "@/lib/navigation";
import { CartBag } from "./cart/CartBag";

export function SiteHeader({ quotationOnly = true }: { quotationOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggle = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(); toggle.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <header className="site-header sticky top-0 z-50 border-b border-(--border) bg-[rgba(9,8,7,0.78)] backdrop-blur-xl">
      <nav
        className="maison-container flex min-h-16 items-center justify-between gap-4 py-3 sm:min-h-20 sm:gap-6 sm:py-4"
        aria-label="Primary navigation"
      >
        <a href="#" className="flex min-w-0 items-center gap-3 sm:gap-4" aria-label="Home">
          <span className="brand-medallion shrink-0">
            <Image
              src="/images/logo-la-palme-dor-no-bg.png"
              alt="La Palme d'Or Gems logo"
              width={128}
              height={84}
              priority
              className="h-16 w-auto object-contain sm:h-20"
            />
          </span>
          <span className="navbar-brand-text font-display hidden truncate text-ivory lg:inline">
            La Palme d&apos;Or Gems
          </span>
        </a>

        <div className="hidden items-center gap-1 text-[0.82rem] uppercase tracking-[0.18em] text-[rgba(229,213,189,0.78)] lg:mr-7 lg:flex xl:gap-5">
          {primaryNavigation.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="nav-link shrink-0 transition-colors duration-300 hover:text-gold"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="relative flex shrink-0 items-center gap-2 sm:gap-3">
          {!quotationOnly ? <CartBag onNavigate={close} /> : null}
          <button
            ref={toggle}
            type="button"
            className="nav-menu-button inline-flex h-11 w-11 flex-col items-center justify-center gap-[5px] rounded-md border border-[rgba(217,189,122,0.28)] bg-[rgba(255,250,240,0.06)] text-ivory transition hover:border-[rgba(217,189,122,0.45)] hover:bg-[rgba(255,250,240,0.1)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold)] lg:hidden"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            <span
              className={`block h-[2px] w-[1.15rem] rounded-full bg-current transition ${open ? "translate-y-[7px] rotate-45" : ""}`}
              aria-hidden
            />
            <span
              className={`block h-[2px] w-[1.15rem] rounded-full bg-current transition ${open ? "opacity-0" : ""}`}
              aria-hidden
            />
            <span
              className={`block h-[2px] w-[1.15rem] rounded-full bg-current transition ${open ? "-translate-y-[7px] -rotate-45" : ""}`}
              aria-hidden
            />
          </button>

          <Link
            href="/appointment"
            className="navbar-cta inline-flex min-h-10 items-center justify-center px-3.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] sm:min-h-11 sm:px-5 sm:text-xs sm:tracking-[0.18em]"
            onClick={close}
          >
            <span className="sm:hidden">Consult</span>
            <span className="hidden sm:inline">Consult the Designer</span>
          </Link>
        </div>
      </nav>

      <div
        id={panelId}
        role="navigation"
        aria-label="Site sections"
        aria-hidden={!open}
        className={
          open
            ? "lg:hidden border-t border-[rgba(217,189,122,0.14)] bg-[rgba(9,8,7,0.97)] shadow-[0_20px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl"
            : "hidden"
        }
      >
        <div className="maison-container flex flex-col py-2 pb-4">
          {primaryNavigation.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="nav-link border-b border-[rgba(217,189,122,0.12)] py-3.5 text-[0.78rem] font-semibold uppercase tracking-[0.2em] text-[rgba(229,213,189,0.88)] transition-colors last:border-b-0 hover:text-gold"
              onClick={close}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
