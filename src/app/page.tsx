import Image from "next/image";

import { BespokeProcessCarousel } from "@/components/BespokeProcessCarousel";
import { HeroRingStage } from "@/components/HeroRingStage";
import { SiteHeader } from "@/components/SiteHeader";
import { connection } from "next/server";
import { quotationOnly } from "../lib/commerce-policy.ts";

const signaturePoints = [
  "Pendants shaped around personal meaning",
  "Bracelets composed for ceremony and daily elegance",
  "Earrings balanced for light, movement, and poise",
  "Rings designed around rare colour and proportion",
];

const trustItems = [
  {
    label: "Since 1973",
    text: "Founded on decades of private jewelry commissions.",
  },
  {
    label: "40+ Years in Egypt",
    text: "Trusted experience across stones, settings, and service.",
  },
  {
    label: "IGI-Certified Stones",
    text: "Natural stones selected with accredited documentation and careful provenance review.",
  },
  {
    label: "Atelier Craft",
    text: "Rings, pendants, bracelets, earrings, and one-of-one pieces made with restraint.",
  },
];

export default async function Home() {
  await connection();
  return (
    <main className="luxury-page">
      <SiteHeader quotationOnly={quotationOnly()} />

      <section className="hero-section" aria-labelledby="hero-title">
        <div className="hero-bg-wrap" aria-hidden="true">
          <Image
            src="/images/background.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="hero-bg"
          />
        </div>

        <Image
          src="/images/leaf-1.png"
          alt=""
          width={640}
          height={480}
          sizes="(max-width: 640px) 35vw, 25rem"
          className="hero-leaf hero-leaf--one"
          aria-hidden="true"
        />
        <Image
          src="/images/leaf-2.png"
          alt=""
          width={640}
          height={480}
          sizes="(max-width: 640px) 30vw, 23rem"
          className="hero-leaf hero-leaf--two"
          aria-hidden="true"
        />

        <div className="hero-overlay" aria-hidden="true" />

        <div className="maison-container hero-inner">
          <div className="hero-copy">
            <p className="hero-eyebrow hero-text-reveal hero-text-reveal--1">
              La Palme d&apos;Or Gems
            </p>
            <h1
              id="hero-title"
              className="hero-title hero-text-reveal hero-text-reveal--2 font-display text-balance"
            >
              <span className="hero-title-line">Where Rare Stones Become</span>
              <span className="hero-title-line">Personal Heirlooms.</span>
            </h1>
            <p className="hero-supporting hero-text-reveal hero-text-reveal--3">
              Private bespoke jewelry design shaped around your vision, crafted
              with natural stones and more than four decades of Egyptian jewelry
              heritage.
            </p>
          </div>

          <HeroRingStage>
            <div className="hero-ring-float">
              <div className="hero-ring-tilt">
                <Image
                  src="/images/yellow-sapphire-ring-no-bg.png"
                  alt="Yellow sapphire ring by La Palme d'Or Gems"
                  width={900}
                  height={900}
                  priority
                  className="hero-ring-image"
                />
              </div>
            </div>
          </HeroRingStage>

          <div className="hero-actions hero-text-reveal hero-text-reveal--4">
            <a href="/appointment" className="hero-cta hero-primary-button">
              Consult the Designer
            </a>
            <a href="#catalog" className="hero-cta hero-secondary-button">
              Explore the Catalog
            </a>
          </div>
        </div>
      </section>

      <div className="lp-transition lp-transition-black-to-cream" />

      <BespokeProcessCarousel />

      <section
        id="catalog"
        className="signature-section"
        aria-labelledby="signature-title"
      >
        <div
          className="lp-transition lp-transition-cream-to-black"
          aria-hidden="true"
        />
        <div className="signature-inner maison-container">
          <div className="signature-copy">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.28em] text-gold">
              Signature collections
            </p>
            <div className="gold-hairline mb-6" />
            <h2
              id="signature-title"
              className="font-display max-w-2xl text-balance text-[clamp(2.35rem,6.5vw,4.4rem)] font-semibold leading-[0.98] text-ivory"
            >
              Natural stones, composed with restraint.
            </h2>
            <p className="mt-7 max-w-xl text-base leading-8 text-[rgba(229,213,189,0.78)] sm:text-lg">
              Explore refined starting points for bespoke pendants, bracelets,
              earrings, and rings &mdash; each adapted to your preferred stone,
              setting, proportion, and sentiment. Every piece begins as an idea
              and is shaped through a private design conversation.
            </p>

            <ul className="signature-points">
              {signaturePoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>

            <a href="/contact?intent=BESPOKE" className="signature-cta">
              Begin a Bespoke Piece
            </a>
          </div>

          <div className="signature-frame-wrap">
            <div className="royal-frame-scene signature-feature-frame">
              <div className="signature-frame-inner">
                <div
                  className="signature-frame-sparkle-bg"
                  aria-hidden="true"
                />
                <Image
                  src="/images/earrings-emerald-no-bg.png"
                  alt="Emerald earrings"
                  fill
                  sizes="(max-width: 640px) 78vw, (max-width: 1024px) 42vw, 460px"
                  className="signature-frame-jewel"
                />
              </div>
              <Image
                src="/images/royal-oval-frame.png"
                alt=""
                fill
                sizes="(max-width: 640px) 82vw, (max-width: 1024px) 46vw, 500px"
                className="royal-frame-overlay signature-frame-overlay"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      </section>

      <section
        id="heritage"
        className="heritage-section"
        aria-labelledby="heritage-title"
      >
        <div
          className="lp-transition lp-transition-black-to-cream"
          aria-hidden="true"
        />
        <div className="heritage-main">
          <div className="heritage-container">
            <div className="heritage-heading-block">
              <span className="heritage-watermark" aria-hidden="true">
                1973
              </span>
              <p className="section-eyebrow heritage-eyebrow">
                Heritage and Trust
              </p>
              <h2
                id="heritage-title"
                className="heritage-title font-display text-balance font-semibold"
              >
                A jewelry house shaped by four decades of Egyptian craftsmanship.
              </h2>
              <p className="heritage-lede">
                Since 1973, La Palme d&apos;Or has served generations of clients
                through private commissions, natural stones, and carefully finished
                jewelry.
              </p>
            </div>

            <div className="heritage-trust-grid">
              {trustItems.map((item) => (
                <article key={item.label} className="heritage-trust-card">
                  <span className="heritage-card-crest" aria-hidden="true" />
                  <h3 className="heritage-card-title font-display font-semibold">
                    {item.label}
                  </h3>
                  <p className="heritage-card-copy">{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
        <div
          className="lp-transition lp-transition-cream-to-black"
          aria-hidden="true"
        />
      </section>

      <section id="appointment" className="section-spacing">
        <div className="royal-frame maison-container appointment-panel bg-[linear-gradient(135deg,rgba(217,189,122,0.18),rgba(21,63,54,0.22)_48%,rgba(255,255,255,0.04))] text-center">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-gold">
            Private appointments
          </p>
          <div className="gold-hairline mx-auto mb-6" />
          <h2 className="font-display mx-auto max-w-3xl text-balance text-[clamp(2.7rem,11vw,3.75rem)] font-semibold leading-[1.02] text-ivory sm:text-6xl">
            Begin Your Bespoke Journey
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-[rgba(229,213,189,0.86)]">
            Meet with La Palme d&apos;Or Gems for a private design appointment,
            or request access to curated pieces featuring emeralds, rubies,
            sapphires, diamonds, and other natural stones of distinction.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
            <a
              href="/appointment"
              className="cta-primary inline-flex min-h-12 items-center justify-center bg-gold px-6 text-xs font-semibold uppercase tracking-[0.14em] text-charcoal transition duration-300 hover:bg-ivory sm:px-7 sm:text-sm sm:tracking-[0.16em]"
            >
              Request a Consultation
            </a>
            <a
              href="#catalog"
              className="cta-secondary inline-flex min-h-12 items-center justify-center border border-(--border) px-6 text-xs font-semibold uppercase tracking-[0.14em] text-ivory transition duration-300 hover:border-gold hover:text-gold sm:px-7 sm:text-sm sm:tracking-[0.16em]"
            >
              View Catalog
            </a>
          </div>
        </div>
      </section>

      <footer id="contact" className="border-t border-(--border) py-12">
        <div className="maison-container flex flex-col items-center gap-8 text-center md:flex-row md:items-end md:justify-between md:text-left">
          <div className="max-w-md md:max-w-none">
            <Image
              src="/images/logo-la-palme-dor-no-bg.png"
              alt="La Palme d'Or Gems logo"
              width={142}
              height={93}
              className="brand-footer-logo h-20 w-auto object-contain"
            />
            <p className="font-display mt-4 text-2xl font-semibold text-ivory">
              La Palme d&apos;Or Gems
            </p>
            <p className="mt-3 max-w-md text-sm leading-6 text-beige">
              Bespoke natural stone jewelry, privately designed in Egypt with a
              heritage of craftsmanship since 1973.
            </p>
          </div>
          <address className="not-italic text-sm leading-7 text-beige md:text-right">
            Cairo, Egypt
            <br />
            Appointments by request
            <br />
            contact@lapalmedorgems.com
            <br />
            Since 1973
          </address>
        </div>
      </footer>
    </main>
  );
}
