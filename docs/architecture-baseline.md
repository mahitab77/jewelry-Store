# Architecture baseline — Phase 00

Verified on 2026-10-27. This document describes the existing client-approved demo; it does not define or implement the future store.

## Repository and toolchain

- Existing Git checkout on `master`, starting at `20c8507`. The tracked working tree and index were clean. Initial untracked files were `.vscode/settings.json` and `Windows-SSD (C) - Shortcut.lnk`. No repository initialization, remote changes, branch changes, commits, pushes, or deployment occurred.
- Package name: `la-palma-dor-gems`, private, version `0.1.0`. Customer-facing branding: La Palme d'Or Gems.
- Next.js `16.2.6`, React/React DOM `19.2.4`, TypeScript `5.9.3`, Tailwind CSS/PostCSS `4.3.0`, ESLint `9.39.4`, and `eslint-config-next` `16.2.6` were installed. Verification used Node.js `22.17.1` and npm `11.13.0` on Windows/PowerShell.
- `package-lock.json` uses lockfile version 3, matches the root dependency declarations, and has 429 package entries with registry.npmjs.org resolved URLs. `npm ls --depth=0` passed. Dependencies were already present, so `npm ci` was unnecessary and was not run; a clean installation was not verified. No dependency or lockfile changes were made.
- Read `AGENTS.md`, its `CLAUDE.md` reference, and the installed Next.js CLI, deployment, static-export, and font guidance in `node_modules/next/dist/docs/`.

## Core layout and behavior

```text
src/
  app/
    layout.tsx                  Root HTML, metadata, Google font setup
    page.tsx                    Single homepage route /
    globals.css                 Tailwind import, theme, layouts, motion, breakpoints
    favicon.ico                 Existing favicon
  components/
    SiteHeader.tsx              Client-side navigation and mobile menu
    HeroRingStage.tsx           Client-side pointer tilt and motion preferences
    BespokeProcessCarousel.tsx  Four-step carousel and adaptive navigation placement
public/
  images/                      40 existing brand/design images
  {file,globe,next,vercel,window}.svg  Starter assets retained
docs/
  architecture-baseline.md      This baseline
```

- The homepage composes the header, sapphire-ring hero, bespoke process, signature collection, heritage/trust cards, appointment panel, and contact footer. Links navigate to in-page sections (`#bespoke`, `#catalog`, `#heritage`, `#appointment`, `#contact`).
- Header state controls the mobile menu, scroll lock, Escape dismissal, and closing at the desktop breakpoint. The hero uses pointer events, animation frames, and reduced-motion/fine-pointer media queries. The carousel uses local React state, layout measurements, and `ResizeObserver`; it describes a design process, not a booking workflow.
- `layout.tsx` loads Inter and Cormorant Garamond (weights 400–700) through `next/font/google`, with Latin subsets and swap display. Fonts are downloaded at build time and self-hosted by Next.js; a fresh build environment may need Google Fonts network access.
- `globals.css` owns the black/cream/gold palette, emerald accents, responsive composition, decorative effects, hover states, hero animations, and reduced-motion treatment. Existing images use `next/image` with the default optimizer.
- `next.config.ts` contains an empty configuration. `postcss.config.mjs` enables `@tailwindcss/postcss`. ESLint uses the Next.js Core Web Vitals and TypeScript flat configurations, ignoring generated outputs. TypeScript is strict with bundler resolution, incremental checking, generated Next.js types, and the `@/*` → `src/*` alias.
- `README.md` is the original create-next-app starter guide, not an architecture document. Its Geist font description and `app/page.tsx` example do not describe the current fonts or `src/app` location. It was preserved; no competing baseline document existed.

## Approved design boundary

Treat `src/app/page.tsx`, `src/app/globals.css`, `src/components/SiteHeader.tsx`, `src/components/HeroRingStage.tsx`, and `src/components/BespokeProcessCarousel.tsx` as the immutable approved design baseline for this phase. Also preserve the root layout/font setup, brand images, typography, animations, spacing, colors, styles, and layouts. Do not rewrite, reorder, reformat, rename assets, substitute a theme, or introduce a UI library. All application/configuration files and assets were left unchanged in Phase 00.

## Asset inventory and repository hygiene

- The 40 brand images total 38,391,315 bytes. Important referenced assets include `background.png`, `leaf-1.png`, `leaf-2.png`, `logo-la-palme-dor-no-bg.png`, `yellow-sapphire-ring-no-bg.png`, `earrings-emerald-no-bg.png`, `royal-oval-frame.png`, `customer-sketch.png`, `designer-sketch-1.png`, `pink-gemstones.png`, and `ruby-earring-no-bg.png`. All literal source image references resolve.
- Twenty-nine brand images have no literal references in current source. These include alternate sketches, necklaces, logo variants, original/cutout pairs, and unusually spelled names such as `dimanond-ring-no-bg.png` and `dark-green-emerlad-earring.png`. Lack of a reference does not establish that an asset is disposable. SHA-256 comparison found no byte-identical duplicates among the brand images. All were retained.
- The five root starter SVGs are unreferenced by current source and remain tracked. The pre-existing Windows shortcut is unrelated to the application and was retained. `.vscode/settings.json` suppresses unknown CSS at-rule diagnostics and remains untracked and unchanged; potentially shareable editor settings were not blanket-ignored.
- Existing ignore rules already cover dependencies, `.next`, `out`, `build`, coverage, environment files (`.env*`), PEM files, package-manager debug logs, Vercel local metadata, `next-env.d.ts`, and TypeScript build info. The only addition is `/*.lnk`, excluding local Windows shortcuts at the repository root while preserving existing rules.
- Current tracked filenames contain no environment/credential files. Pattern checks of the 16 tracked text/config/source files found no common credential tokens, private keys, assigned secrets, or credential-bearing URLs. No root `.env*` files were present. This was a current-tree check, not a Git-history secret audit.
- `.next/`, `node_modules/`, and `next-env.d.ts` existed before verification. Normal ignored build outputs were retained. The newly generated root `tsconfig.tsbuildinfo` and temporary browser screenshots were removed after inspection; no screenshots, test scripts, logs, or audit reports were added to the repository. Nothing was staged.

## Commands and verified results

| Command/check | Result |
| --- | --- |
| `npm ls --depth=0` | Passed; installed top-level dependencies present |
| `npm run lint` | Passed, exit 0; no diagnostics |
| `npx tsc --noEmit` | Passed, exit 0; no diagnostics |
| `npm run build` | Passed, exit 0; default Turbopack production build, type checking, and prerendering completed |
| `npm.cmd run start -- --hostname 127.0.0.1 --port 3100` | Production server started; homepage returned HTTP 200 |
| Chromium smoke check at `http://127.0.0.1:3100` | Passed at desktop 1440×1000 and mobile 390×844; title/content present, no framework overlay, console errors/warnings, failed requests, HTTP errors, broken images, or document horizontal overflow detected |
| Interaction checks | Carousel next/previous changed the active step at both sizes; mobile menu opened, closed with Escape, and closed after navigating to Heritage |

Available scripts are `npm run dev` (`next dev`), `npm run build` (`next build`), `npm run start` (`next start`), and `npm run lint` (`eslint`). Development mode was not separately launched. The first production launch using the PowerShell npm wrapper misparsed forwarded flags; invoking `npm.cmd` as shown above resolved that environment-specific issue without a project change. No existing application check failures were found.

The build reports `/` and Next.js's generated `/_not-found` as prerendered static routes; this is not a configured static export. Browser plugin not available: smoke checks reused cached Playwright `1.51.1` and an existing Chromium executable, with no installation. Desktop/mobile screenshots were inspected temporarily outside the repository. No separate historical reference screenshots were supplied; preservation is established by unchanged source/assets, not a pixel comparison to an earlier deployment. Other browsers, sizes, and exhaustive interaction/accessibility testing were outside this baseline check.

## Existing limitations and deployment considerations

- This is a presentation demo with no database, API routes, server actions, authentication, product data service, cart, checkout, payments, order management, admin area, or persistent booking. The appointment button points back to `#appointment`; catalog links point to the showcase section. No booking submission is implemented. Contact information is static text.
- There are no project test scripts/suites, CI workflows, Docker files, or provider deployment configuration in the checkout. The README suggests Vercel generically; it does not establish a live deployment. Current build/start scripts describe a standard Next.js Node server.
- No Wrangler configuration, Cloudflare adapter, Workers bindings, compatibility settings, or deployment scripts are present. Cloudflare's current [Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/) recommends vinext (beta) for Workers and documents OpenNext as another path. Either would require a separate compatibility review and toolchain/configuration work; neither was adopted here. In particular, review Next.js `16.2.6` support and image optimization on the chosen runtime before selecting a future path.
- For static hosting, `output: "export"` is not configured. The default `next/image` optimizer is unsupported in a static export, so a future static-hosting decision needs an explicit image strategy (see the installed Next.js static-export guide). Do not infer Cloudflare readiness from a successful local Node build.

Phase 00 establishes a working, unchanged design baseline. Phase 01 can be scoped from this document; implementation, dependency changes, and deployment remain separate work.
