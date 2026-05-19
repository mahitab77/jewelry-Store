"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const steps = [
  {
    stepLabel: "STEP 01",
    title: "Share Your Vision",
    copy: "Bring your first idea to us — whether it is a rough sketch, a saved inspiration, or a personal concept you want to transform into jewelry.",
    image: "/images/customer-sketch.png",
    imageAlt: "Customer sketch and initial jewelry concept",
    imageVariant: "default" as const,
  },
  {
    stepLabel: "STEP 02",
    title: "Refine with a Designer",
    copy: "Your concept is translated into a professional design sheet, with precise proportions, stone placement, and a clear artistic direction.",
    image: "/images/designer-sketch-1.png",
    imageAlt: "Designer technical sketch with proportions and stone placement",
    imageVariant: "default" as const,
  },
  {
    stepLabel: "STEP 03",
    title: "Select the Gemstones",
    copy: "Choose the natural stones, colours, and character of the piece. Every selection is made to suit your design, setting, and personal taste.",
    image: "/images/pink-gemstones.png",
    imageAlt: "Curated pink gemstones for bespoke selection",
    imageVariant: "default" as const,
  },
  {
    stepLabel: "STEP 04",
    title: "Receive the Final Jewel",
    copy: "The design is handcrafted and finished into a complete piece, ready to be worn as a refined personal jewel.",
    image: "/images/ruby-earring-no-bg.png",
    imageAlt: "Finished ruby earring by La Palme d'Or Gems",
    imageVariant: "jewel" as const,
  },
];

type StepCardStyle = CSSProperties & {
  "--step-offset": number;
  "--step-visibility": number;
};

type NavPlacement = "below" | "in-card";

const NAV_RESERVE_PX = 58;
const GAP_BUFFER_PX = 28;

function shouldForceNavBelow(): boolean {
  if (typeof window === "undefined") return true;
  return (
    window.matchMedia("(max-width: 720px)").matches ||
    window.matchMedia("(max-height: 640px)").matches
  );
}

type BespokeCarouselNavProps = {
  variant: NavPlacement;
  activeIndex: number;
  onPrevious: () => void;
  onNext: () => void;
  onSelectStep: (index: number) => void;
};

function BespokeCarouselNav({
  variant,
  activeIndex,
  onPrevious,
  onNext,
  onSelectStep,
}: BespokeCarouselNavProps) {
  const toneClass =
    variant === "in-card"
      ? "bespoke-nav bespoke-nav--in-card"
      : "bespoke-nav bespoke-nav--below";

  return (
    <div
      className={`bespoke-carousel-controls ${toneClass}`}
      role="toolbar"
      aria-label="Bespoke journey navigation"
    >
      <button
        type="button"
        className="bespoke-carousel-button bespoke-nav-button"
        aria-label="Show previous bespoke appointment step"
        onClick={onPrevious}
      >
        PREVIOUS
      </button>

      <div
        className="bespoke-carousel-indicators"
        role="group"
        aria-label="Bespoke appointment steps"
      >
        {steps.map((step, index) => (
          <button
            key={step.stepLabel}
            type="button"
            className="bespoke-carousel-dot"
            aria-label={`Show step ${index + 1}: ${step.title}`}
            aria-current={index === activeIndex ? "step" : undefined}
            onClick={() => onSelectStep(index)}
          >
            {String(index + 1).padStart(2, "0")}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="bespoke-carousel-button bespoke-nav-button"
        aria-label="Show next bespoke appointment step"
        onClick={onNext}
      >
        NEXT
      </button>
    </div>
  );
}

export function BespokeProcessCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [navPlacement, setNavPlacement] = useState<NavPlacement>("below");
  const activeInnerRef = useRef<HTMLDivElement | null>(null);
  const placementRef = useRef<NavPlacement>("below");

  const goToPrevious = () => {
    setActiveIndex((currentIndex) =>
      currentIndex === 0 ? steps.length - 1 : currentIndex - 1,
    );
  };

  const goToNext = () => {
    setActiveIndex((currentIndex) =>
      currentIndex === steps.length - 1 ? 0 : currentIndex + 1,
    );
  };

  const evaluateNavPlacement = useCallback(() => {
    if (shouldForceNavBelow()) {
      setNavPlacement("below");
      placementRef.current = "below";
      return;
    }

    const inner = activeInnerRef.current;
    if (!inner) {
      setNavPlacement("below");
      placementRef.current = "below";
      return;
    }

    const card = inner.closest(".bespoke-step-card") as HTMLElement | null;
    if (!card) {
      setNavPlacement("below");
      placementRef.current = "below";
      return;
    }

    const media = inner.querySelector<HTMLElement>(".bespoke-card-media");
    const body = inner.querySelector<HTMLElement>(".bespoke-card-body");
    const cta = inner.querySelector<HTMLElement>(".bespoke-carousel-cta");
    const inCardNav = inner.querySelector<HTMLElement>(
      ".bespoke-nav--in-card",
    );

    const cardH = card.getBoundingClientRect().height;
    const mediaH = media?.getBoundingClientRect().height ?? 0;
    const bodyH = body?.getBoundingClientRect().height ?? 0;
    const ctaH = cta?.getBoundingClientRect().height ?? 0;
    const innerStyle = getComputedStyle(inner);
    const padY =
      parseFloat(innerStyle.paddingTop) +
      parseFloat(innerStyle.paddingBottom);

    const prev = placementRef.current;

    if (prev === "in-card") {
      const navH = inCardNav?.getBoundingClientRect().height ?? NAV_RESERVE_PX;
      const used = mediaH + bodyH + navH + ctaH + padY + GAP_BUFFER_PX;
      if (cardH - used < 4) {
        placementRef.current = "below";
        setNavPlacement("below");
        return;
      }
      placementRef.current = "in-card";
      setNavPlacement("in-card");
      return;
    }

    const usedNoNav = mediaH + bodyH + ctaH + padY + GAP_BUFFER_PX;
    const slack = cardH - usedNoNav;
    if (slack >= NAV_RESERVE_PX + 10) {
      placementRef.current = "in-card";
      setNavPlacement("in-card");
      return;
    }

    placementRef.current = "below";
    setNavPlacement("below");
  }, []);

  useLayoutEffect(() => {
    const inner = activeInnerRef.current;
    const card = inner?.closest(".bespoke-step-card") as HTMLElement | null;

    const ro = new ResizeObserver(() => {
      evaluateNavPlacement();
    });

    if (inner) ro.observe(inner);
    if (card) ro.observe(card);

    window.addEventListener("resize", evaluateNavPlacement);

    queueMicrotask(() => {
      evaluateNavPlacement();
    });

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", evaluateNavPlacement);
    };
  }, [activeIndex, evaluateNavPlacement]);

  return (
    <section
      id="bespoke"
      className="bespoke-carousel-section bespoke-section"
      aria-labelledby="bespoke-carousel-title"
    >
      <div className="maison-container bespoke-carousel-layout">
        <div className="bespoke-carousel-header bespoke-intro">
          <p className="bespoke-carousel-eyebrow">Bespoke Appointment</p>
          <div className="gold-hairline mx-auto mb-3" />
          <h2
            id="bespoke-carousel-title"
            className="bespoke-carousel-title font-display text-balance px-1 font-semibold leading-[1.02] text-[var(--charcoal)]"
          >
            <span className="bespoke-carousel-title-line">From a private vision</span>
            <span className="bespoke-carousel-title-line">to a finished jewel.</span>
          </h2>
          <p className="bespoke-intro-copy mx-auto text-balance">
            Every commission begins with a conversation. Meet a designer, shape
            your idea, refine the details, choose your stones, and watch your
            piece come to life.
          </p>
        </div>

        <div
          className="bespoke-carousel-shell"
          aria-live="polite"
          data-nav-placement={navPlacement}
        >
          <div className="bespoke-carousel-track">
            {steps.map((step, index) => {
              const offset = index - activeIndex;
              const wrappedOffset =
                offset > steps.length / 2
                  ? offset - steps.length
                  : offset < -steps.length / 2
                    ? offset + steps.length
                    : offset;
              const isActive = index === activeIndex;

              return (
                <article
                  key={step.stepLabel}
                  className="bespoke-step-card"
                  data-active={isActive}
                  aria-hidden={!isActive}
                  style={
                    {
                      "--step-offset": wrappedOffset,
                      "--step-visibility": Math.abs(wrappedOffset) <= 1 ? 1 : 0,
                    } as StepCardStyle
                  }
                >
                  <div
                    className="bespoke-card-inner"
                    ref={isActive ? activeInnerRef : undefined}
                  >
                    <div className="bespoke-card-media">
                      <div className="bespoke-card-image">
                        <Image
                          src={step.image}
                          alt={step.imageAlt}
                          width={720}
                          height={480}
                          sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 520px"
                          className={
                            step.imageVariant === "jewel"
                              ? "bespoke-card-image-img bespoke-card-image-img--jewel"
                              : "bespoke-card-image-img"
                          }
                        />
                      </div>
                    </div>
                    <div className="bespoke-card-body">
                      <span className="bespoke-step-kicker">{step.stepLabel}</span>
                      <h3 className="bespoke-card-title font-display">
                        {step.title}
                      </h3>
                      <p className="bespoke-card-copy">{step.copy}</p>
                    </div>
                    {isActive ? (
                      <div className="bespoke-card-footer">
                        {navPlacement === "in-card" ? (
                          <BespokeCarouselNav
                            variant="in-card"
                            activeIndex={activeIndex}
                            onPrevious={goToPrevious}
                            onNext={goToNext}
                            onSelectStep={setActiveIndex}
                          />
                        ) : null}
                        <a href="#appointment" className="bespoke-carousel-cta">
                          Book a Private Appointment
                        </a>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>

          {navPlacement === "below" ? (
            <BespokeCarouselNav
              variant="below"
              activeIndex={activeIndex}
              onPrevious={goToPrevious}
              onNext={goToNext}
              onSelectStep={setActiveIndex}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
