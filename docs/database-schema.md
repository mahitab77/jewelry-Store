# PostgreSQL schema and catalogue access — Phases 01–02

Neon PostgreSQL Free is the intended provider; no hosted database was contacted. Phase 01 established the schema below. Phase 02 adds a server-only `pg` connection module, read-only catalogue repository, local migration/seed tooling and database tests. No ORM, public API, authentication, checkout, payment integration or UI change is included. SQL uses standard PostgreSQL facilities, UUID keys with built-in `gen_random_uuid()`, exact `NUMERIC(12,4)` gemstone weights, `BIGINT` minor-unit money, and `TIMESTAMPTZ`. No extensions are required. Execution validation used PostgreSQL 17.10.

Statuses use `TEXT` with named `CHECK` constraints rather than enums so later changes can use ordinary additive migrations without enum-specific deployment steps. Currency codes use three uppercase letters, defaulting to `EGP`; later services must validate supported currencies and their minor-unit exponents. For EGP, 100 minor units = EGP 1.00. Prices in different currencies are independent amounts, not automatic conversions.

## Tables and relationships

All business entities live in one database's `public` schema. Every table, including association tables and the migration ledger, has a UUID primary key. Required relationships are `NOT NULL`; optional customer references allow guest activity.

| Table | Purpose and relationships |
| --- | --- |
| `categories` | Hierarchy through `parent_id`; globally unique slug, visibility, ordering. |
| `collections` | Editorial groupings; unique slug, draft/published/archived state and publication date. |
| `products` | Catalogue identity, description, unique slug, product type, sales mode and publication state. |
| `product_categories` | Unique product/category assignment, many to many. |
| `product_collections` | Unique product/collection assignment, many to many, with optional display order. |
| `product_variants` | Product-owned SKU, size/configuration, metal details, activation and ordering. |
| `product_prices` | Variant-owned currency amounts; zero or more inactive rows, at most one active row per currency. |
| `product_media` | Product-owned external asset reference, image/video type, alt text and ordering; at most one primary image. |
| `gemstones` | Individual stone or reusable group specification: type, variety, shape, decimal weight, color, treatment, optional origin/laboratory/report. |
| `product_gemstones` | Variant/specification assignment, role, quantity, optional total carat weight and ordering. |
| `customer_profiles` | Optional independent future identity linkage and contact details; not required for checkout. |
| `customer_addresses` | Mutable saved Egyptian addresses owned by profiles. |
| `admin_users` | Future independent identity linkage, display name, role and activation; no credentials or seeded accounts. |
| `carts` | Hashed session identifier, optional profile, currency, status and expiry. |
| `cart_items` | One selected variant/quantity per cart; no reservation side effect. |
| `orders` | Stable UUID/order number, optional cart/profile, contact snapshots, currency/totals and separate order/payment/fulfillment states. |
| `order_items` | Order-owned SKU/name/configuration/quantity/price snapshots; optional product/variant links. |
| `order_addresses` | One delivery address snapshot per order, independent of saved addresses. Collection needs no delivery address. |
| `payments` | Multiple payment attempts per order, unique local reference, Paymob references, amount/currency, outcome and refund totals. |
| `payment_events` | Deduplicated callback receipt, optional attempt association, verification flag, processing state/time and safe error codes. |
| `order_status_history` | Order, payment or fulfillment transition, responsible system/admin, reason and timestamp. |
| `inventory` | One physical stock counter per variant, including its reserved subset. |
| `inventory_reservations` | Unique hold reference, variant/quantity, cart and/or order ownership, expiry and terminal state/time. |
| `boutique_locations` | Configured Egyptian collection locations and active state. |
| `fulfillment_arrangements` | Order-owned delivery/collection plan, schedule, assigned/completing staff and destination; optional prior arrangement for rescheduling. |
| `fulfillment_events` | Arrangement timeline, actor/time, typed handover recipient/evidence reference and notes. |
| `bespoke_requests` | Guest/profile contact snapshot, optional product, message, design-enquiry status and assigned staff. |
| `appointment_requests` | Guest/profile contact snapshot, optional product/bespoke request/location, requested/confirmed time, status and staff. |
| `product_enquiries` | Guest/profile contact snapshot, optional product, message, status and staff. |
| `audit_events` | System/admin action against a target table/UUID, timestamp and bounded metadata. Target references intentionally survive target deletion. |
| `schema_migrations` | Applied filename/version, timestamp and additive SHA-256 checksum tracking; infrastructure, not a customer-facing domain. |

## Ownership and database-enforced constraints

- Products are `ONE_OF_A_KIND`, `REPEATABLE` or `BESPOKE`; sales modes are `DIRECT_PURCHASE`, `ENQUIRY_ONLY` or `BOTH`. Bespoke products must be enquiry-only. Products and collections start `DRAFT`; `PUBLISHED` requires a publication timestamp. No product must have a price, image or inventory row merely to exist.
- Variants own prices and inventory; products own category/collection assignments and media. A one-of-a-kind product has at most one variant. Size/configuration changes for that physical jewel must not mint extra stock-owning SKUs. SKUs use canonical uppercase characters; slugs use lowercase hyphenated characters.
- `product_type` on variants and inventory is an intentional, constrained discriminator copy: composite foreign keys keep it identical to the parent. This permits local stock checks without cross-table triggers. Product type cannot change under existing variants; classification corrections require an explicit reviewed data migration rather than relabeling stock.
- Inventory quantities are nonnegative, reserved cannot exceed on-hand, one-of-a-kind on-hand cannot exceed one, and bespoke stock must be zero. `on_hand` means physical units not yet deducted for completed sales, including held units. `reserved` is its temporarily unavailable subset; availability is derived as `on_hand - reserved`.
- Active prices are unique per variant/currency. Price changes deactivate the old row and create a new active row in one transaction. Order snapshots never read historical amounts back from the live price table. Primary media must be an image; its unique partial index permits only one primary per product.
- Gemstones attach to variants, avoiding ambiguous product-level defaults when variants differ. `INDIVIDUAL` assignments require quantity one and cannot attach the same stone to another variant. `GROUP` represents a reusable specification, not an individually tracked physical lot; assignment quantity and optional total weight describe the accents for one jewel. Optional per-stone weights and totals are exact decimals and reject nonpositive/NaN values. No laboratory/provenance claim is automatically verified. Marking a report verified requires report/laboratory fields; verified provenance requires an origin. Actual evidence review is a later staff responsibility. Individually certified sellable pieces should be one-of-a-kind SKUs; enforcing suitability across the variant/stone relationship remains a catalogue-service responsibility.
- Every cart has a lowercase SHA-256 token hash and expiry; its profile is optional. Later services must hash high-entropy random bearer tokens and keep raw tokens out of database rows/logs. A hash is an identifier, not an implemented authentication/authorization system.
- Reservation quantities are positive, require cart/order ownership, and have explicit expiry and terminal timestamps. When both cart and order are supplied, a composite FK requires that order's source cart. There is at most one active hold per order/variant and one active cart-only hold per cart/variant. Promoting a cart hold to an order retains its original cart association.
- Order totals satisfy `total = subtotal - discount + tax + fulfillment_fee`, with nonnegative amounts and discount at most subtotal. Item subtotals/totals are generated from quantity, snapshotted unit price, line discount and line tax, preventing conflicting line arithmetic. Order-level discounts/taxes are aggregate snapshots of the line allocations; fulfillment fees are separate. Aggregate equality across rows is enforced later in checkout transactions. Items inherit currency from their order. A supplied variant must belong to the supplied product; unlinked custom line snapshots are possible without inventing catalogue records.
- Payment currency must match its order. Local payment references and provider transaction references are unique. Provider order/intention references may span retried attempts; they are indexed, not unique. Callback deduplication keys and non-null actual provider event IDs are unique per provider. A processed event requires an associated payment, a verification flag and a processed timestamp. Refund amounts cannot exceed the attempt amount and must agree with refund state.
- Fulfillment methods are exactly `PRIVATE_DELIVERY` and `BOUTIQUE_COLLECTION`. Arrangements must match their order's method. Delivery references that same order's checkout address snapshot and has no collection location. Confirmed/in-progress/completed collection requires an existing boutique location. Confirmation requires a complete schedule window. Completion requires a staff reference and completion timestamp; a handover event requires responsible staff and a named recipient. At most one current arrangement, including a completed one, exists per order. Rescheduling retains the old row as `RESCHEDULED` and links its replacement to the same order; a predecessor has at most one successor.

## Lifecycles and transactional work still required

The schema defines state vocabularies and local integrity, **not a checkout or callback implementation**. Checks do not enforce allowed transitions or compare arbitrary rows; see [PostgreSQL's constraints documentation](https://www.postgresql.org/docs/17/ddl-constraints.html).

- Orders: `PENDING_PAYMENT → CONFIRMED → COMPLETED`, with cancellation policy to be implemented. Payment summary: `UNPAID/PENDING → PAID/FAILED`, then partial/full refund if applicable. Fulfillment summary: `UNARRANGED → SCHEDULED → IN_PROGRESS → COMPLETED`, independently cancellable. Writing a payment outcome does not automatically update an order or arrange an appointment.
- Attempts: `CREATED → PENDING → SUCCEEDED/FAILED/CANCELLED/EXPIRED`; successful attempts may become partially/fully refunded. Failed retries create separate attempt rows. Later processing must verify callback authenticity and match local reference, provider transaction, amount and currency before applying an outcome. Browser redirects never establish payment success.
- Events: `RECEIVED → PROCESSED/IGNORED/FAILED`; failed processing may retry the existing receipt. Use a real stable provider event ID when available, otherwise a deterministic key from authenticated event identity **and relevant outcome**; a transaction ID alone can suppress legitimate later state changes. Do not store raw callback payloads or secrets. Verification flags are data fields, not cryptographic verification code.
- Holds: `ACTIVE → CONSUMED/RELEASED/EXPIRED`. Adding a cart item creates no hold. A later checkout transaction must validate published/active/purchasable state, prices, quantities and ownership; lock the order and inventory rows in a consistent order; conditionally increment reserved only where availability covers the request; and insert/update the hold in that same transaction. Reconcile `inventory.reserved` with active reservation quantities. Wall-clock expiry does not release stock automatically.
- On verified sale completion, atomically consume the hold and decrement **both** on-hand and reserved exactly once. Later handover must not deduct stock again. Releasing/expiring a hold decrements reserved only. A late successful callback after expiry must revalidate/reacquire stock or enter an explicit refund/manual-resolution path; it must not resurrect a consumed/expired hold or oversell. Idempotency also requires transactional state guards, locking and history writes, beyond the unique event key.
- Arrangements: `REQUESTED → CONFIRMED → IN_PROGRESS → COMPLETED`, with cancellation or replacement by rescheduling. Coordinate old/new rows, events, and order summary in one transaction. Check location/staff activation, actual schedule availability, actor permissions, predecessor status/cycles and agreement between completion record/event. Payment, order confirmation, a bespoke appointment, and jewelry handover remain separate decisions.
- Later services must validate longer category cycles, stable published slugs, currency allowlists, order/cart currency and identity consistency, line/header totals, eligibility of unlinked custom lines, prevention/reconciliation of duplicate charges, valid state transitions, event/payment reference agreement and staff evidence for certification/provenance. No multi-session checkout concurrency test or real Paymob callback test has been implemented in this phase.
- `updated_at` defaults on insert; later mutations must update it explicitly. Financial snapshots, UUIDs/order numbers and append-only audit/history/event records must be treated as immutable by later write paths and permissions. This phase does not add update-blocking triggers or database access roles; a privileged SQL writer can still alter rows.

## Deletion, privacy and retention

Archive products instead of deleting them once used. Financial, reservation, fulfillment, gemstone/media/price and audit-actor relationships use `RESTRICT`; no cascading delete can erase order/payment/history rows. Only product/category/collection association rows, saved customer addresses and cart items have cascading ownership cleanup. Orders/reservations retain their source cart, preventing its deletion while referenced. Optional profile links use `SET NULL`, preserving contact/address snapshots; deleting a profile removes its mutable saved addresses, not purchase history. Deactivate staff and boutique locations referenced by history.

Snapshots survive live catalogue/contact/address changes, but retention is not indefinite by default: a later reviewed policy must define business/legal retention periods and controlled redaction of personal snapshots after those periods. Keep only operational contact/address and handover details; no identity-document copies, card numbers, CVVs, payment credentials, bearer tokens or raw webhooks. Free-form messages/notes need access control and retention too. Audit metadata is the only JSONB field: an object capped at 4096 serialized bytes, intended for allowlisted operational identifiers/change codes, not arbitrary PII.

No anonymous/public database API or grants are configured here. Before connecting any application, implement independent authentication/authorization, least-privilege server-side roles, protected secret storage and permitted public catalogue projections. UUIDs and hidden UI do not provide access control. Do not expose customer, cart, order, payment, enquiry or staff tables through public database credentials. No Supabase Auth assumptions exist.

## Applying and tracking migrations locally

Files are ordered and self-transactional:

1. `0001_catalogue.sql` — migration ledger, catalogue and gemstones.
2. `0002_customers_admin_carts.sql` — profiles, addresses, admin identity linkage and carts.
3. `0003_orders_payments.sql` — order snapshots, attempts, receipts and status history.
4. `0004_inventory.sql` — counters and reservations, after cart/order references exist.
5. `0005_fulfillment_requests_audit.sql` — locations, arrangements/events, requests and audit.
6. `0006_migration_checksums.sql` — additive checksum column and known Phase 01 baseline hashes; no existing migration was rewritten.

Use the explicit Node runner, not the former five-file manual application loop. It accepts contiguous numeric filenames, validates history as an exact prefix, and verifies SHA-256 of UTF-8 contents with CRLF normalized to LF. This normalization makes Windows/Unix checkouts agree without ignoring substantive whitespace changes. Known Phase 01 hashes are pinned. Already applied, unchanged files are a verified no-op; missing/reordered/changed files, inconsistent ledger entries, and nonempty databases without a ledger fail explicitly.

A dedicated connection holds a session advisory lock for the entire run; another runner fails rather than racing. Each file's outer `BEGIN`/`COMMIT` is removed and replaced by a runner-controlled transaction containing its DDL, original ledger insert and checksum stamp. Failure rolls all three back. This minimal runner supports the current DDL migrations; internal transaction commands and dollar-quoted routines are rejected. It has no reset, destructive rollback, startup hook or public endpoint.

The added checksum column stays nullable to bridge old self-recording SQL, but the runner requires a complete matching checksum on every applied row once migration 0006 exists. Migration 0006 stamps the five known historical hashes; the runner stamps its own hash before commit. An existing checksum-free Phase 01 ledger requires `--adopt-existing`: first verify the actual database was built from the reviewed Phase 01 files, inspect its ledger/schema and retain a backup for persistent data. A ledger cannot retroactively prove which SQL originally ran. Never adopt an unknown schema simply to silence a mismatch. Once applied to any persistent environment, freeze each migration and use new numbered files for changes.

Tooling is deliberately limited to non-production execution, loopback hosts and names matching `lapalme_dev_*` or `lapalme_test_*`. There is no hosted override. Example from the repository root, using an existing local PostgreSQL instance and your own local role:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$pgPort = 5432
$pgRole = 'YOUR_LOCAL_ROLE'
$databaseName = 'lapalme_dev_catalogue'
& "$pgBin\createdb.exe" --host=127.0.0.1 --port=$pgPort --username=$pgRole $databaseName
if ($LASTEXITCODE -ne 0) { throw 'Could not create a fresh local database' }
if (-not (Test-Path -LiteralPath .env.local)) {
    Copy-Item -LiteralPath .env.example -Destination .env.local
}
# Edit .env.local locally: set DATABASE_URL to this database and your actual role.
# Do not print or commit its contents. Existing environment variables take precedence.
npm.cmd run db:migrate -- --local
npm.cmd run db:seed -- --development
# Only for a reviewed existing five-migration local baseline:
# npm.cmd run db:migrate -- --local --adopt-existing
```

Node 22.17+ runs the TypeScript tools using built-in type stripping and the `react-server` condition for `server-only`; no test framework/transpiler dependency was added. `allowImportingTsExtensions` permits the same explicit `.ts` imports in Next.js and these scripts. Node 22.17 emits harmless experimental/module-detection warnings; the project-wide module format was preserved. On Unix, use the equivalent PostgreSQL binaries and `npm run` commands. The Node tooling itself is cross-platform.

## Environment and connection module

- `DATABASE_URL` is the sole runtime database setting. It is server-only, checked on the first database operation, and never required to import modules or build the existing homepage. `.env.example` has placeholders; `.env.local` remains ignored. Standalone migration/seed commands load `.env.local` through Node's `--env-file-if-exists`; tests use a separate explicit `TEST_DATABASE_URL` and never load that file.
- `src/lib/db/config.ts` accepts PostgreSQL URLs with optional `sslmode=require`, `verify-full`, or loopback-only `disable`. Non-loopback TLS always sets `rejectUnauthorized: true`; URL parameters cannot overwrite it. Unsupported SSL modes, client-certificate paths and other query parameters fail safely. The optional `channel_binding` setting controls pg's channel-binding capability; it is not a claim that the driver enforces a libpq-style mandatory channel-binding negotiation. Private-CA/client-certificate environments need a separately reviewed configuration extension, not verification bypasses.
- `src/lib/db/client.ts` lazily reuses one Node-runtime pool, capped at four clients, with 5-second acquisition/connect, 8-second server statement, 10-second query/idle/idle-transaction timeouts, and 60-second connection lifetime. Limits apply per runtime instance, not across a serverless fleet. `withDatabaseClient` always releases borrowed clients and discards failed ones. `withTransaction` supplies a single transaction-scoped client; catalogue detail reads use read-only repeatable-read isolation. `closeDatabase()` drains the pool after script/test work. No migrations run from this module.
- Errors have only safe `DatabaseError` codes/messages (`DATABASE_NOT_CONFIGURED`, `DATABASE_CONFIGURATION_INVALID`, `DATABASE_UNAVAILABLE`), without raw SQL errors, causes, passwords or URLs. Idle connection failures log only a fixed message. Do not grant runtime reads superuser rights. Tests prove catalogue reads with SELECT on only the catalogue tables and inventory; provision real least-privilege roles before hosting.
- Both connection and repository modules import `server-only`; importing them into a Client Component is a build error. Pure result types live separately. No homepage/component imports the data layer, and no connection-test endpoint exists.

## Read-only catalogue API

Import server-side from `src/lib/catalogue/repository.ts`; result contracts are in `types.ts`:

| Function | Return and behavior |
| --- | --- |
| `getPublishedCategories()` | `PublicCategory[]`; visible rooted categories whose ancestors are visible, display order then UUID. |
| `getPublishedCollections()` | `PublicCollection[]`; published and publication time reached, display order then UUID. |
| `getPublishedProducts(options?)` | `ProductPage`: `items`, `limit`, `offset`, `hasMore`. One SQL statement with aggregated active variants/primary image; no per-product query loop. |
| `getPublishedProductBySlug(slug)` | `PublicProductDetail` or `null`; five fixed queries in one read-only snapshot, including ordered media, visible category/collection associations, active variants and public stone specifications. |
| `getProductsByCategorySlug(slug, options?)` | Same page contract, with exact category filter; nonexistent/hidden category yields an empty page. |
| `getProductsByCollectionSlug(slug, options?)` | Same page contract, with exact collection filter; nonexistent/unpublished collection yields an empty page. |

Options: integer `limit` 1–50 (default 20), integer `offset` 0–10000 (default 0), `sort` `newest` (publication descending/UUID) or `name_asc` (C collation/UUID), optional `categorySlug` and `collectionSlug` filters combined with AND. Slugs are lowercase hyphenated ASCII, 1–160 characters. Invalid options/slugs throw `CatalogueInputError` before connecting; valid nonexistent product slugs return `null`. Values use SQL parameters; sorting uses a fixed expression allowlist. Category filtering is exact, not automatic descendant expansion. Product visibility comes from published status/time, independently of category visibility; hidden associations never appear in details.

Only active variants and active EGP prices are public in this phase. `PublicPrice.amountMinor` is a decimal integer **string**, and gemstone weights are decimal strings, preserving precision beyond JavaScript safe integers. No price is invented. `fromPrice` is the lowest valid active public variant price, including out-of-stock variants. `pricingMode` is `PRICED`, `PRICE_ON_REQUEST` or `ENQUIRY_ONLY`. Enquiry-only/bespoke prices are suppressed even if a price row exists. `canEnquire` follows sales mode; unpriced direct-only products cannot purchase and do not gain an invented enquiry permission.

`canPurchase` requires an active variant, direct-purchase-eligible product, active EGP price and positive `on_hand - reserved`. Variant availability is `IN_STOCK`, `OUT_OF_STOCK`, `NOT_TRACKED` or `ENQUIRY_ONLY`. Raw counters are excluded. Availability is a momentary observation, never a hold or checkout guarantee. Reads do not create inventory reservations. Missing inventory/price prevents purchase; currency conversion and checkout revalidation remain future work.

Public projections omit laboratory/report identifiers, certificate/provenance/origin fields, private-domain tables, internal timestamps and raw inventory. Stone type/variety/shape/color, optional carat/treatment, quantity and role are public. `product_media.external_media_reference` is intended for public media only; no private document reference belongs there. Images are returned as references/metadata; Cloudinary transformations/uploads are not implemented.

## Development fixtures and tests

The guarded seed creates four development-labelled categories, a published/unpublished collection, and six development-labelled products: one-of-a-kind, repeatable with two variants, unpriced enquiry-only, bespoke, draft and archived. It includes EGP prices, available/out-of-stock inventory, existing image paths checked on disk and an explicitly unverified stone example. Deterministic reserved UUIDs and `ON CONFLICT (id) DO NOTHING` make replay idempotent without replacing existing rows. This is initial fixture insertion, not a catalogue synchronization or repair command. Conflicting non-fixture unique values fail the transaction. No customer, cart, order, payment, personal data or fabricated certificate/provenance is seeded.

`npm run test:db` uses Node's test runner and requires an explicit loopback `TEST_DATABASE_URL` pointing to a disposable cluster's maintenance database. Its local test role needs permission to create/drop test databases and a temporary read-only role; runtime catalogue reads do not. Each run creates random `lapalme_test_*` databases, removes them and its role in teardown, and removes temporary migration copies outside the repository. Never point it at a real or hosted database.

Example isolated test cluster (Windows, unused port 55440; trust authentication is restricted to this short-lived loopback fixture instance):

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('la-palme-test-' + [guid]::NewGuid().ToString('N'))
& "$pgBin\initdb.exe" -D "$testRoot\data" --username=phase02_validator --auth=trust --encoding=UTF8 --no-locale
if ($LASTEXITCODE -ne 0) { throw 'Test cluster initialization failed' }
& "$pgBin\pg_ctl.exe" -D "$testRoot\data" -l "$testRoot\postgres.log" -o '-h 127.0.0.1 -p 55440' -w start
if ($LASTEXITCODE -ne 0) { throw 'Test cluster start failed' }
try {
    $env:TEST_DATABASE_URL = 'postgresql://phase02_validator@127.0.0.1:55440/postgres'
    npm.cmd run test:db
    if ($LASTEXITCODE -ne 0) { throw 'Database tests failed' }
} finally {
    & "$pgBin\pg_ctl.exe" -D "$testRoot\data" -m fast -w stop
    Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
}
# After confirming shutdown, remove only this explicitly created $testRoot directory.
```

The original `db/tests/schema-verification.sql` remains unchanged and specifically tests the five-migration Phase 01 baseline. The new suite executes it on that baseline before testing adoption, then separately validates fresh six-migration databases, verified replay, locking, drift/gaps/history mismatch, partial rollback, idempotent seed, publication/filtering/details, pagination/input safety, exact prices, enquiry restrictions, media/stones, availability, least-privilege reads and sanitized connection failures.

## Hosted setup and runtime boundaries

Neon is **not connected or validated**. Later, create/select the intended Neon database/branch, review backups and provision separate migration-owner and restricted runtime-read credentials. Store the runtime URL only in server-side secrets, retaining TLS verification; account for provider connection limits and pooling. Review a direct/session-preserving connection for future advisory-locked migrations; transaction-pooled connections cannot be assumed to retain session locks. Hosted schema changes and seeding require explicit authorization. This phase's CLI refuses remote hosts even if credentials are present; there is no automatic Neon project creation or deployment.

Cloudflare Workers compatibility is **not verified**. Its [PostgreSQL guide](https://developers.cloudflare.com/workers/tutorials/postgres/) documents pg support and Node compatibility requirements, which depend on compatibility date. No adapter, Wrangler configuration, vinext or Hyperdrive was added. The shared pool here is verified in Node only; Worker request-owned I/O, socket lifetime, pool reuse and cleanup must be validated/adapted before deployment. A local build does not prove Workers/Neon compatibility.

## Verification boundary

Phase 01's five migrations and rollback-only constraint test passed on PostgreSQL 17.10. Phase 02's six migrations and 15 database integration tests passed on another isolated loopback cluster, including original-baseline verification, checksum adoption and non-superuser reads. Frontend lint, TypeScript checking and the production build were checked without a configured database. Approved source/assets, the architecture baseline and the first five migrations remain unchanged. Node 22.17's type-stripping/module-detection warnings do not indicate test failures.

Remaining validation belongs to later phases: concurrent purchases, authenticated/out-of-order/late Paymob callbacks, authorization/privacy controls, hosted migration execution, actual Neon connectivity and Cloudflare runtime compatibility. No checkout or hosted-integration readiness is implied by local catalogue tests.

## Phase 03: public catalogue pages

The new `/collections`, `/collections/[category]`, `/collections/edit/[slug]` and `/jewels/[slug]` routes use the six existing repository functions without changing them or any migration. Category paths use actual published category slugs; the permanent development seed therefore uses `/collections/dev-rings`, while a real `rings` record resolves at `/collections/rings`. Editorial collections have a separate `edit` path to avoid category ambiguity. The approved homepage and its existing anchor navigation are unchanged.

The route group uses request-time `connection()` and asynchronous params/searchParams. It does not access the database during builds. Per-request React caching shares metadata/page reads without persisting results between requests. Listings use 12 records per page, validated `page`/`sort` parameters and repository ordering; invalid selections redirect to the route's first page. Unknown/unpublished records use `notFound()`. Empty selections, missing configuration and connection failure have separate presentations; database outages render an informative, unindexed page rather than a false 404.

New styles are scoped in `src/components/catalogue/catalogue.module.css`, using existing tokens, fonts, gradients and button treatments. Interactive code is limited to the new page header, image gallery and configuration selection. No cart, checkout or purchase handler exists. An available variant can lead to boutique contact; enquiries use the existing `/#contact` or `/#appointment` destination. Zero-photo records have an explicit photography-by-request state. This phase supports existing local image references; external media integration is deferred.

Prices are formatted directly from integer minor-unit strings; variants retain their own price/availability. Development entries are visibly labelled and receive `noindex`, including if fixture data is deployed. Optional server-only `SITE_URL` must be a verified HTTPS origin to emit canonical URLs; without it, no live hostname is invented. No ratings, reviews, certificate documents or structured certification claims are added.

Verification commands:

```powershell
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd run build
# Use the isolated local cluster setup above:
$env:TEST_DATABASE_URL = 'postgresql://phase03_validator@127.0.0.1:55441/postgres'
npm.cmd run test:db
npm.cmd run test:storefront
# Use an already available Playwright module and matching Chromium executable:
$env:PLAYWRIGHT_MODULE = 'C:\path\to\playwright\index.mjs'
$env:CHROMIUM_EXECUTABLE = 'C:\path\to\chrome.exe'
npm.cmd run test:storefront:browser
```

The browser suite requires a current production build, uses local ports 3110–3112, starts/stops its own Next.js processes and creates/removes a uniquely named fixture database and restricted read role. The maintenance URL must point at an explicitly disposable loopback cluster with database/role creation permissions. The examples' role/port must match your own cluster initialization. No browser dependency was added; `PLAYWRIGHT_MODULE` can be omitted where `playwright` is already resolvable. Optional `HOMEPAGE_BASELINE_DIR` enables exact comparison against `homepage-before-desktop.png` and `homepage-before-mobile.png` captured with reduced motion at 1440×1000 and 390×844. Optional `STOREFRONT_SCREENSHOT_DIR` must be outside the repository; the caller inspects and removes these requested screenshots afterward.

## Phase 04: editorial information pages

`/bespoke`, `/gemstones`, `/maison`, `/services`, `/appointment` and `/contact` use the existing catalogue shell/header with scoped editorial styling. The bespoke page reuses `BespokeProcessCarousel` unchanged. The shared catalogue/editorial header now links Bespoke, Contact and the appointment button to these routes; its footer reaches all six editorial pages. The original homepage, `SiteHeader`, anchor links, carousel source, global CSS, fonts and images are unchanged.

These are information pages, not database submission workflows. Existing request tables remain unused, and no migration, public write endpoint, notification or scheduling integration was added. The owner explicitly requested that contact availability remain unconfirmed. The existing homepage mailbox is retained internally with `emailConfirmed: false` in `src/lib/editorial/contact.ts`; new pages do not publish it as an active link. Contact and appointment pages show the transparent availability state, no forms and no confirmed dates. Only a separately confirmed address can produce a mailto link; link generation is tested, not email delivery.

Brand history uses only the established Egyptian heritage and 1973 foundation copy. Services are presented as general care advice or questions requiring boutique confirmation, without availability, price or turnaround promises. Gemstone education and care reference [GIA's Gem Encyclopedia](https://www.gia.edu/gem-encyclopedia) and its [jewelry-care guide](https://www.gia.edu/gia-news-research-Tips-Caring-Jewelry). Illustrations do not authenticate individual stones. No universal laboratory certification or origin is asserted.

Each page has its own title, description, headings and internal links. Canonicals use the existing metadata helper only when a valid HTTPS `SITE_URL` origin is known; for these static information pages, configure it before building. No organization schema, addresses, ratings or external social accounts were invented. Builds do not require database or integration credentials.

Run `npm run test:editorial` for the contact-policy tests in addition to the existing database/storefront commands. `npm run test:storefront:browser` now also checks all six editorial routes, shared navigation, the reused carousel/FAQ, truthful contact/appointment states, metadata, imagery and desktop/tablet/mobile rendering. Use a disposable local PostgreSQL cluster and an existing Playwright/Chromium installation as documented above. No new dependencies were introduced.

The Phase 04 homepage comparison preserves both starting references and compares decoded pixels when PNG bytes differ. It allows only colour-rounding differences of at most 8/255 per channel, affecting at most 2.5% of pixels, to accommodate Chromium's image/filter rasterization; dimensions must match. This replaces the Phase 03 byte-only comparison described above. The first Phase 04 run identified only mobile ring-image rounding (maximum 7/255; approximately 2% of pixels, depending on the decoder); desktop matched exactly. Protected source and assets are also checked against their starting SHA-256 hashes.

## Phase 05: administrator authentication and access control

Better Auth **1.7.14**, pinned in the lockfile, owns password verification, session identifiers, signed cookies and session lookup/revocation. Its [PostgreSQL integration](https://better-auth.com/docs/adapters/postgresql) accepts the existing `pg` driver; its included Kysely adapter is a query builder, not a newly adopted application ORM. No Prisma/Drizzle client, identity subscription or hosted account was introduced. The package is approximately 2 MB unpacked before transitive dependencies; only the small form components enter the browser bundle. Telemetry and authentication-library logging are disabled, preventing driver errors or submitted credentials from entering application logs. Operational monitoring must use the safe audit events instead.

The initial Phase 05 checkout was clean at `3990583`; Phases 03 and 04 had been committed by the operator. All public source, styling and images remain unchanged. Next.js and its matching ESLint configuration were updated from 16.2.6 to **16.4.3** because the installed version had reported critical advisories, including [unauthenticated Windows server code execution](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36). Compatible updates to six flagged transitive packages removed the remaining dependency findings, without a forced audit fix or new direct dependencies beyond Better Auth. A local Node build does not establish Workers support.

### Schema and identity continuity

`0007_admin_authentication.sql` is additive after the six immutable migrations and uses the existing checksum runner. It maps Better Auth's user model directly to `admin_users`, preserving IDs and the existing audit foreign key. It adds nullable unique canonical email, verification state and optional image fields. Existing `OWNER`, `MANAGER` and `STAFF` records and identity links remain intact. The latter two legacy roles cannot authenticate through this foundation until deliberately reviewed and provisioned with a supported new role; they are not silently promoted or renamed. Existing external identities are never overwritten automatically.

The migration adds the library's credential-account, session and verification models plus an atomic rate-limit table. Credential rows are restricted to the password provider with a matching administrator subject. Optional library OAuth columns remain empty; OAuth, recovery and verification endpoints are unavailable. All temporal columns use `TIMESTAMPTZ`; foreign keys restrict deletion and no audit-history cascade was introduced. There are no default administrators, passwords, credentials or automatic provisioning in migrations/seeds. Existing guest/customer/catalogue data and schemas are unchanged.

### Configuration and least privilege

Public pages and builds do not need any authentication setting. Authentication is initialized lazily on a relevant request. Set only server-side values:

- `ADMIN_DATABASE_URL`: a dedicated restricted authentication role in the same PostgreSQL database. It does not fall back to the catalogue's read-only `DATABASE_URL` or a migration-owner role. Existing TLS verification and pool/time limits are reused.
- `BETTER_AUTH_URL`: the exact application origin, without a path, wildcard or credentials. Production requires HTTPS. Only non-production loopback permits HTTP.
- `BETTER_AUTH_SECRET`: a unique random 32-byte base64url secret, kept identical across instances. Generate it locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` and place it in the secret store, not Git. Placeholders, short values and low-variety values are rejected.
- Optional `ADMIN_TRUSTED_IP_HEADER`: `cf-connecting-ip` or `x-real-ip`, **only** when the chosen edge overwrites it and the origin cannot be reached directly. No forwarded header is trusted by default. Never use `NEXT_PUBLIC_` for these values.

Provision a non-owner runtime database role separately. Grant schema usage, `SELECT` on `admin_users`, `admin_auth_accounts`, `admin_auth_sessions`, `admin_auth_verifications`; `INSERT, DELETE` on `admin_auth_sessions`; `SELECT, INSERT, UPDATE, DELETE` on `admin_auth_rate_limits`; and only `INSERT` on `audit_events`. The runtime has no administrator/credential writes, audit updates/deletes, DDL, or order/payment access. Provisioning and migrations use separate reviewed operator credentials, never web-runtime credentials. The integration suite validates these actual restricted grants.

### Authentication, sessions and authorization

`/admin/login` provides accessible email/password input and generic failures. Its form has POST semantics so a missing JavaScript runtime cannot send a password in a GET query; interactive sign-in uses JSON and requires JavaScript. `/api/admin-auth/[...all]` permits only JSON POST sign-in and sign-out. Registration is additionally disabled in the library itself. All user updates, password changes/recovery, account linking, role mutation and public session-inspection endpoints are unavailable. The API returns only `{ "ok": true }` after success, never Better Auth's default token-bearing JSON.

Better Auth creates fresh random sessions with an eight-hour absolute lifetime and no rolling refresh or cookie cache. Its cookie is HttpOnly, SameSite=Strict, and Secure on HTTPS, with the library's secure prefix in production. No localStorage or query-string credentials are used. Each access validates the signed cookie and database session, then reads the trusted administrator's active status, provider/subject linkage and role. Logout is POST-only; the wrapper verifies revocation before reporting success because the library can catch a failed database deletion internally. Expired, tampered, revoked or disabled sessions cannot authorize a request.

Better Auth 1.7.14 has no supported core session-token hashing option: the library-managed session identifier is stored in its standard token column, and the cookie is signed. Passwords use the library's salted scrypt hashing. Do not substitute verification-token hashing settings or add a parallel cookie/token framework. Restrict database reads/backups, preserve TLS, and never log or serialize session identifiers. Session hashes at rest are therefore a documented library limitation, not a claimed feature.

`getCurrentAdmin`, `requireAdmin` and `requirePermission` return a minimal trusted DTO and fail closed. `OWNER` has all defined future permission scopes; `ADMIN` has catalogue and operational scopes; `CATALOGUE_MANAGER` has catalogue scope. All three can enter the minimal landing page. These scopes do not implement management tools. Client role/identity claims are rejected. Checks run in the server data-access helpers and protected page as well as the protected layout. A scoped Next.js Proxy also guards the entire `/admin` namespace except login and the separately protected logout operation; the public site is outside its matcher. Future actions/routes must call the authorization helper inside the operation even when a page/layout/proxy already checked access. Do not cache authorization between requests or trust a browser-provided permission.

### Distributed throttling, CSRF and audit

The library's supported `customStorage.consume` delegates to PostgreSQL atomic UPSERTs, not an in-memory Map or separate read/write counters. Login has a shared source limit of 30 attempts per 15 minutes and an account limit of five per 15 minutes, independent of whether the address exists. A transport-wide limit of 120 requests per minute also bounds invalid-input/origin auditing. Account/source keys are keyed HMACs; raw email/IP values are not retained. Without a verified edge header, source limiting conservatively shares one bucket across clients, so spoofed forwarding headers cannot bypass it. This can affect other administrators behind a shared source. An untrusted directly reachable origin must never enable trusted proxy headers.

Fixed windows do not extend when denied attempts arrive; counts saturate and a fresh window can reopen after expiry. An ongoing targeted attack can still cause temporary account/source denial: no email/password-only limiter can eliminate that tradeoff. Counters expire after at most 15 minutes and expired rows are opportunistically deleted in bounded batches on subsequent authentication traffic. During inactivity, the final expired rows remain until the next attempt; no raw attempted identities are stored. A reviewed maintenance job can additionally delete expired counters and sessions. This is intentionally not a claim of scheduled physical erasure without a configured scheduler. Database outages fail closed; there is no unthrottled memory fallback.

The library's origin/CSRF protections remain enabled. The transport additionally requires an exact configured Origin, rejects cross-site Fetch Metadata, accepts only bounded JSON, rejects query parameters and rejects unexpected fields. Login and logout tests cover both transport and library origin enforcement. Future authenticated mutations need the same origin policy in addition to server-side authorization.

`audit_events` records provisioning, successful/failed login, logout, denied access, throttling and rejected origins with fixed event names. Unknown attempts use system actors and random correlation targets, without submitted emails, passwords, hashes, tokens, cookies or request bodies. Provisioning metadata contains only role and whether an existing record was linked. Runtime database grants make normal application audit writes append-only. A login cookie is not delivered unless its success event can be recorded; deactivating an administrator preserves audit history. Audits are not a logging destination for arbitrary request metadata.

### Deliberate operator provisioning

Apply migration 0007 with the existing local runner after reviewing history. The runner still refuses remote/hosted migrations; no Neon migration has been executed. After deployment, an authorised operator must first apply the reviewed schema through the separately approved migration procedure, then run provisioning from a trusted local terminal against the intended database with owner/provisioner credentials. No boot/deployment hook creates accounts.

Set `ADMIN_DATABASE_URL` for that operator process and run:

```powershell
npm.cmd run admin:provision -- --email ACTUAL_OPERATOR_EMAIL --name "ACTUAL_OPERATOR_NAME" --role OWNER --confirm-admin-create
```

The CLI prompts for a hidden password. Never pass a password as an argument, SQL literal or seed value. For controlled automation it accepts `ADMIN_PROVISION_PASSWORD` from the process environment, removes it from its own environment immediately, never prints it, and requires that the calling process clear it in `finally`. Do not persist it in `.env.example` or shared shell history. Noninteractive runs without that protected input fail. Remote provisioning additionally requires deliberate `--allow-remote-provisioning`, TLS and operator review; it does not run migrations. **No real administrator was created during Phase 05.**

Use a unique 16–128-character password/passphrase with at least eight distinct characters, unrelated to the email address; common password prefixes are rejected. Hashing uses the library and occurs before the short provisioning transaction. Email uniqueness and a transaction/advisory lock prevent accidental duplicate creation; the same transaction writes the credential, identity and audit event. There is no implicit overwrite/reset operation. To attach an existing *unlinked* legacy administrator while preserving its UUID/audit relationships, explicitly add `--existing-admin-id EXISTING_UUID` and select the reviewed new role. Linked external/already-provisioned identities require separate reviewed handling rather than automatic replacement.

A trusted operator can disable an account with `UPDATE admin_users SET is_active=false, updated_at=now() WHERE id=...` and delete that administrator's `admin_auth_sessions` rows in the same reviewed transaction. Active-status checks deny access immediately even before physical session deletion. This is an operator procedure, not a public account/role-management feature. Secret rotation invalidates old signed sessions and changes rate-limit key namespaces; coordinate it across instances, expire old sessions/counters and assess active-incident throttling before rotating.

### Verification and deployment boundary

Run `npm run test:admin` with an explicit disposable loopback `TEST_DATABASE_URL`, in addition to the existing database/storefront/editorial tests. It creates and removes only marked test identities, databases and a restricted auth role. It covers schema upgrade/data preservation, hashing, input failures, generic credential failures, session creation/expiry/revocation/tampering, disabled users, server permissions, client claims, concurrent sessions, shared limits across actual OS processes, CSRF, audit privacy/append-only grants, audit failure and failed revocation. `tests/database.test.mts` advances expected ledger length to seven and moves its deliberately failed migration fixture to 0008; the original constraint tests and six migration files remain unchanged.

`npm run test:admin:browser` uses an existing Playwright/Chromium, a current production build, loopback Next servers on 3120/3121 and an HTTPS test proxy on 3443. Supply `ADMIN_TEST_TLS_KEY`/`ADMIN_TEST_TLS_CERT` pointing to disposable self-signed test files, alongside the existing browser module/executable settings. Only the browser ignores that local certificate; production origin/Secure-cookie settings are never weakened. Optional `ADMIN_SCREENSHOT_DIR` must stay outside the repository. The caller inspects/removes screenshots and TLS files afterward. The suite removes its accounts/database/role and stops its processes. No browser dependency was added.

Neon execution, actual mail delivery, password recovery, MFA, edge-header provenance and Cloudflare Workers deployment remain outside local verification. Workers must separately validate Next.js adapter support, request-owned PostgreSQL connections, free-tier CPU/memory limits and the library's scrypt runtime implementation. A successful Node test/build does not establish free Workers viability. No paid service, customer authentication, product management, cart, checkout, payment, hosted migration or deployment was added.

Local Phase 05 results: 23 authentication integration/security tests, five HTTPS admin browser groups, 15 database tests (including the original rollback-only schema checks), four storefront unit tests, three editorial tests and ten existing public browser groups passed. Lint, TypeScript and the Next.js 16.4.3 production build passed with authentication/database settings empty. The dependency audit reported zero vulnerabilities. The public homepage's pre-phase desktop/mobile comparison passed without changing its existing tolerance, and SHA-256 verification preserved 107 starting files, including all public source/assets and migrations 0001–0006. Temporary TLS files, screenshots, fixture databases/roles, processes and cluster storage are disposable verification material, not deployment configuration.

## Phase 06: catalogue administration and product photography

The existing protected layout now reaches `/admin/products`, `/admin/products/new` and `/admin/products/[id]/edit`. The management table searches name/SKU/slug, filters status/type, and fetches only twenty records plus a next-page sentinel. Sorting is updated time descending, then UUID ascending; displayed update times are UTC. Existing public repository queries remain the catalogue source, with no second product/price store. Public pages already fetch dynamically, so committed publication, price and inventory changes appear on the next request without a separate cache invalidator.

### Schema, grants and transactional editing

Apply additive `0008_catalogue_media.sql` using the existing checksum migration runner; migrations 0001–0007 remain immutable. Nullable provider metadata on `product_media` preserves approved local images while constraining new provider-backed rows. `catalogue_media_jobs` holds durable upload/deletion intents, not image bytes or secrets. Existing `audit_events` supplies durable stock history; no warehouse or adjustment-history subsystem is added.

The existing restricted `ADMIN_DATABASE_URL` role additionally needs these grants in the same database. Replace the illustrative role name deliberately; do not use an owner role at runtime. Keep the Phase 05 authentication grants and the public `DATABASE_URL` read-only role separate.

```sql
GRANT SELECT ON categories, collections TO catalogue_admin_runtime;
GRANT SELECT, INSERT, UPDATE ON products, product_variants, product_prices, inventory TO catalogue_admin_runtime;
GRANT SELECT, INSERT ON gemstones TO catalogue_admin_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_categories, product_collections, product_gemstones, product_media TO catalogue_admin_runtime;
GRANT SELECT, INSERT, UPDATE ON catalogue_media_jobs TO catalogue_admin_runtime;
GRANT SELECT ON audit_events TO catalogue_admin_runtime;
```

No additional administrator/credential writes, category/collection writes, audit updates/deletes, product/variant deletion, order/payment access, DDL or provisioning privileges are needed. The runtime can read existing audit rows to provide product change history; application queries restrict it to the target product's catalogue events. These are database-service credentials shared by the authorized admin application, not per-human database accounts. Integration fixtures exercise these restricted grants.

Every server read/mutation requires the existing `catalogue:manage` permission: enabled OWNER, ADMIN and CATALOGUE_MANAGER. Page/layout/proxy checks supplement operation-level checks. Each editing transaction re-reads the trusted administrator status/role. The HTTP transport requires exact Origin for POST, rejects cross-site fetch metadata, bounds request bodies and applies a shared PostgreSQL per-admin limit of sixty mutations per minute. Identity, role, reservation quantities and provider confirmations are never editable request fields.

Product, assignments, variants, prices, gemstone associations and audit writes commit together. Microsecond revision tokens plus a product row lock reject stale saves. Existing variants must be retained or deactivated; their product type is locked once variants exist. Price input uses decimal strings and BigInt conversion to EGP minor units, including values above JavaScript's safe integer range. A changed price retires its old active row and inserts its replacement. Gemstone edits copy changed specifications into a new unverified record; unchanged shared records and earlier report/provenance history are preserved. A supplied origin remains declared, not independently verified.

Initial stock applies only to new variants. Later adjustments lock current inventory, apply a bounded signed delta, preserve the current reserved quantity, and require a reason. The transaction rejects negative stock, values below reserved units, one-of-a-kind totals above one and bespoke stock adjustments. Audit metadata records before/after/reserved/delta/reason. This does not implement reservations or checkout. Authorization is evaluated per operation; disabling an account denies later requests but does not retroactively cancel a transaction already in progress.

### Publication and photograph policy

New records start as DRAFT. Publication, including saves to an already published product, requires a valid name/slug, at least one category visible through its ancestor chain, an active valid variant, a compatible sales mode, an active EGP price for every active direct-purchase variant, and valid current inventory. The image rule is at least one recognized primary IMAGE plus meaningful alt text of at least five characters for every image. Stock may be zero: the public repository displays actual unavailability instead of inventing purchasability. Enquiry-only/bespoke records do not acquire invented prices. Explicit Publish sets publication time to now, including when a legacy record had a future timestamp; ordinary saves preserve its existing publication time. Published slugs stay locked after unpublishing; no URL-history migration is implied. Unpublish/archive preserve product, variant, price, order and audit history.

Only product photographs belong in this workflow; laboratory reports and private documents must not be uploaded as photographs. Sharp 0.35.5 is now an explicit pinned dependency, reusing the version already installed through Next.js. It fully decodes JPEG/PNG/WebP, rejects animation/corruption/MIME mismatches, enforces 5 MiB, 200–6000 pixels per side and twenty megapixels, corrects orientation and strips EXIF/GPS before upload. A product supports at most twelve images. New uploads use server-generated identifiers; an atomic reorder validates the complete owned image set, alt text and exactly one primary image. Removal chooses a surviving primary and prevents removing the final image of a published product. No existing local asset file is deleted.

### Cloudinary adapter and partial failure

Set only server-side `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`. No upload preset, unsigned browser endpoint or arbitrary remote source URL is accepted. The adapter uses [Cloudinary's REST Upload API](https://cloudinary.com/documentation/image_upload_api_reference) with HTTPS Basic authentication, fixed parameters and a server-owned `la-palme/catalogue/{product UUID}/{job UUID}` namespace. It checks returned ownership/type/dimensions/format/size and the [upload response signature](https://cloudinary.com/documentation/response_signatures) before association. There is no production mock mode or browser-submitted completion callback.

Assets use [authenticated delivery](https://cloudinary.com/documentation/control_access_to_media), protecting originals and derivatives. Signed provider URLs remain server-side. `/catalogue-images/[id]` returns photograph bytes only while the associated product is currently published; authenticated admin preview uses `/api/admin/catalogue/products/[productId]/photos/[mediaId]`. Both return private/no-store responses. Managed images bypass Next's public optimizer cache so a draft preview cannot become a cached public optimization URL. Unpublishing denies subsequent public image requests; it cannot recall copies already downloaded while published. Existing approved local images retain their original behavior. This conservative delivery route adds an application request per image and needs bandwidth/latency assessment before production.

A short transaction reserves the upload intent, the provider call runs outside the transaction, then a new authorized transaction associates verified metadata and the audit event. Failed/lost responses retain private cleanup intents; an upload lease delays cleanup for five minutes. Removal detaches the database association first and queues provider deletion. Retry cleanup claims at most five eligible tasks, rechecks all product references before deletion, and retains failures for retry. Shared assets are not deleted while still referenced. Cleanup is operator-driven through the editor's Retry provider cleanup button; no automatic scheduler or guaranteed physical-erasure time is claimed. Exceptional provider completion after a cleanup lease still needs operator reconciliation. Monitor retained jobs and account usage; the [Free plan](https://cloudinary.com/pricing) has finite usage limits.

Missing Cloudinary configuration leaves catalogue data editable, disables uploads and shows a truthful status; credentials are unnecessary for a build or the existing homepage. Provider failures use safe feedback without serializing SQL, tokens, credentials or signed delivery URLs. Structured audit events cover product creation/edits, variants, price history, gemstone associations, inventory initialization/adjustment, publication/unpublication/archive, and media association/order/removal/cleanup. Audit failure rolls back associated database changes.

### Verification and runtime boundary

With a disposable loopback `TEST_DATABASE_URL`, run `npm run test:catalogue-admin` in addition to all earlier suites. It covers real PostgreSQL transactions/constraints, permitted roles and denial paths, stale revisions, shared gemstones, exact money, concurrency/reserved stock, visibility, image validation, forged responses, shared-asset protection, cleanup recovery, restricted grants and bounded pagination. `npm run test:catalogue-admin:browser` reuses the HTTPS/Playwright settings described in Phase 05. Run it sequentially with `test:admin:browser` because they share ports 3120/3121/3443. The shared harness removes fixture databases/roles and stops its servers. Caller-owned temporary certificates and optional screenshots must be inspected and removed afterward. Migration test expectations now advance to eight, with the deliberately failing ninth migration remaining a disposable fixture.

The browser suite preloads a test-only deterministic provider mock into its disposable server; production modules do not import it. Tests do not contact Cloudinary, Neon or any production account. Local mock success establishes adapter/workflow behavior, not live upload/delivery/deletion verification. A separate explicitly configured disposable Cloudinary environment must verify those operations before production use.

This phase verifies the Node runtime. Cloudinary's HTTPS API is transport-compatible in principle with Workers, but the current native Sharp validation path needs a Workers-appropriate validated replacement or codec configuration. Request-owned PostgreSQL connections, Better Auth/scrypt, the selected Next.js adapter and free-tier CPU/memory limits also need separate validation. Cloudflare's [Node compatibility reference](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) is not proof that a native Node dependency works unchanged. No deployment adapter, paid service, hosted migration, real administrator, deployment or Phase 07 feature is introduced.

## Phase 07: persistent guest shopping bag

`/cart` uses the existing catalogue shell, palette, fonts and buttons. `/api/cart` reads a guest's current bag; POST `/api/cart/items` adds a variant, and PATCH/DELETE `/api/cart/items/[id]` change/remove an owned line. These paths share one optional catch-all Route Handler. There is no checkout endpoint, order creation, customer login, payment call, fulfillment choice or reservation operation. The disabled checkout control states its current availability truthfully.

### Database and configuration

The original `carts` schema already provides unique SHA-256 token hashes, expiry and lifecycle states; `cart_items_selection_key` already prevents duplicate variant lines. Additive `0009_guest_cart.sql` adds only an observed unit-price column for reliable change notices and a guest-specific rate-limit table. The observed amount never supplies a current selling price. Migrations 0001–0008 are unchanged. No dependency is added or upgraded.

Set `CART_DATABASE_URL` to a separate restricted role in the existing application database. The Phase 02 client now selects a separate lazy cart pool while retaining its existing transaction, timeout, TLS and safe-error behavior. It never falls back to `ADMIN_DATABASE_URL`, an owner credential or the public read-only pool. Keep `DATABASE_URL` read-only for public catalogue rendering. Grant only:

```sql
GRANT USAGE ON SCHEMA public TO guest_cart_runtime;
GRANT SELECT ON products, product_variants, product_prices, product_media, inventory TO guest_cart_runtime;
GRANT SELECT, INSERT, UPDATE ON carts TO guest_cart_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON cart_items, cart_rate_limits TO guest_cart_runtime;
```

The guest role needs no administrator, customer, audit, order, payment or reservation access, and no catalogue/inventory writes or DDL. The runtime does not physically delete carts. The local integration role is deliberately restricted and verifies forbidden operations fail. `CART_ORIGIN` must be the exact public origin without a trailing slash, path or wildcard; production requires HTTPS. Only non-production loopback permits HTTP. No client-exposed environment variables are used. An ordinary visitor or empty bag without a valid cookie creates no database row and does not require cart configuration. Missing configuration fails actual changes safely without claiming success. Builds do not require any integration credentials.

### Identity and persistence

Only a successful first add creates a cart and fresh server-generated 32-byte random base64url token. The HttpOnly, host-only, Path=/ cookie is named `__Host-la-palme-bag` in production and has Secure, SameSite=Lax and an absolute thirty-day expiry. Non-production uses `la-palme-bag`, with Secure on an HTTPS configured origin. Lax permits normal return navigation from external links; mutations independently require exact Origin and reject cross-site Fetch Metadata. These controls follow [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) and [CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Only the token's SHA-256 hash is persisted. Neither token nor hash nor cart UUID is returned in API JSON, and credentials never enter URLs, localStorage, broadcasts or logs. Better Auth cookies and permissions are independent. Every access resolves the cookie hash to an ACTIVE, unexpired, EGP cart with no customer-profile owner. Browser cart/customer IDs are rejected. Unknown/tampered/duplicate cookies cannot be adopted as identities; a later valid add generates a fresh token. Expired, converted and abandoned carts are inaccessible. Mutations do not extend their original expiry.

Browser reloads and restored persistent cookies recover PostgreSQL selections. The client serializes mutations so simultaneous controls share the first successfully established identity. Independent first-time browser contexts without a cookie cannot be identified as the same guest; they create independent sessions. Existing valid sessions serialize safely across application requests. No automatic add retry occurs after a network failure because the request may already have committed; the UI refreshes and asks the visitor to check before retrying.

### Eligibility, amounts and concurrency

Adds and quantity changes read live catalogue records: published at or before now, active variant, non-bespoke, DIRECT_PURCHASE/BOTH, active EGP price, and sufficient `on_hand - reserved`. ONE_OF_A_KIND remains one unit. The application additionally bounds a line at 99 units and a bag at fifty different selections. An existing cart row lock serializes writes. Repeated adds increment the existing line; quantity changes/removals require a microsecond revision token and reject stale updates with the refreshed bag. Foreign item IDs cannot cross the resolved cart boundary.

The final INSERT/UPSERT statement rechecks eligibility, available stock and monetary bounds against its current statement snapshot. A new-cart CTE inserts no cart or line when eligibility fails. No product or stock row write privileges are granted merely to lock them. Inventory can change immediately afterward: a bag is never a stock hold. Cart operations do not alter on-hand/reserved values and do not create inventory reservations, orders or payments. Reservation/purchase concurrency remains future work.

Money comes from current `product_prices.amount_minor`, cast to decimal strings and calculated with BigInt. Per-line and known subtotal amounts are bounded by signed BIGINT limits; SQL uses NUMERIC intermediates to avoid overflowing multiplication. No floating-point money calculation, tax, shipping fee, discount or second price store is introduced. Valid current priced selections contribute to the estimate even when stock has fallen; such selections are explicitly blocked by availability notices. Missing prices/private products or an amount that becomes too large make the subtotal unavailable rather than silently dropping lines or rounding. A stored first-add observation supports a persistent price-change notice even when quantities change; removing the line and adding it again starts a new observation. Checkout must recalculate all amounts later.

Reads revalidate all selections in a consistent snapshot. Lost stock, inactive/unpublished products and missing prices retain the owned cart line so it can be reviewed or removed. Newly private product names, links, configuration and images are not exposed. The bag refreshes on page focus, visibility return, pageshow, every thirty seconds while visible and after mutations. Cross-tab BroadcastChannel messages contain only a refresh signal. Current counts include all selected units, including unavailable selections. Failed refreshes preserve previously loaded selections with a warning and disable editing until refreshed.

### Request controls and abandonment

All personalized JSON responses are private/no-store with Vary: Cookie. The static cart HTML contains no personal selections; the protected API supplies them after load. Mutations require JSON, a maximum 2 KiB decoded body, bounded quantities and UUID validation. Unknown fields, unsupported methods, query parameters and foreign IDs are rejected; SQL parameters never interpolate browser data. Application failures return safe messages without driver details. The application does not log cookies or request bodies.

Atomic fixed-window PostgreSQL counters are separate from administrator authentication: 300 total mutations/minute, thirty new carts/minute and 120 mutations/minute per valid cart; cookie-bearing reads have a shared 600/minute limit. Ordinary no-cookie reads do not create counters. Source headers are not trusted or stored, so spoofed forwarding headers cannot bypass limits. These conservative shared limits can temporarily affect other shoppers and need traffic-informed review before production. Expired counters are opportunistically removed in batches of at most one hundred. This is not a distributed edge firewall or an unbounded per-IP tracking system.

Expiry is enforced by timestamp on every access, independent of maintenance. Mutations opportunistically mark up to fifty expired guest carts EXPIRED, without removing lines. No scheduler is configured. A trusted operator must choose a retention policy and physically remove old EXPIRED/ABANDONED guest carts in bounded batches only after checking that neither orders nor inventory reservations reference them. Existing RESTRICT foreign keys remain authoritative; do not bypass them or delete converted/order history. Until reviewed maintenance runs, expired selections remain inaccessible in database storage. Clearing browser cookies also makes an old bag inaccessible; it is not a request to delete business history.

### UI preservation and verification

The only homepage/header changes are one shared `CartBag` import/control plus a relative positioning class in the existing action wrapper. The 44-pixel control uses the existing gap at normal desktop/mobile widths, preserving the measured baseline geometry. At 1024–1279 pixels it reserves space in the action row to avoid overlapping Contact; the existing brand text can truncate within its original container. Header height, logo and navigation behavior are retained. Catalogue/editorial pages use the same control. The admin logo's public-home link disables speculative prefetch to avoid loading unused public shopping styles in the private workspace. `JewelryOptions` retains gallery, variants, specifications and enquiry presentation; only eligible selections gain the purchase control and matching bag copy. The homepage, global CSS, root layout/fonts, hero, carousel and approved assets remain unchanged.

Run `npm run test:cart` using a disposable loopback `TEST_DATABASE_URL`. It covers ownership, expiry/inactive carts, exact money and overflow, quantity/line limits, concurrency, live stock/price changes, removal, request controls and unchanged inventory/history. `npm run test:cart:browser` reuses the existing TLS/Playwright harness, with admin authentication explicitly unset. Run it sequentially with admin/catalogue-admin browser suites because they share ports. Its desktop/mobile checks exercise the actual bag, selected variants, persistent cookie restoration, cross-tab count, quantity edits, notices, removal and foreign access. Temporary server output is checked against fixture credentials without printing their values. All test data and media services remain local or mocked.

The original public browser suite now requires exactly one bag and still prohibits checkout. Its homepage comparison masks only the new bag's measured 44-pixel bounds plus a two-pixel edge, retaining the original rasterization tolerance elsewhere. Screenshots stay outside the repository and must be inspected then removed. Existing test assertions remain except the migration ledger advance to nine, the disposable failed tenth migration, and the now-obsolete prohibition on a cart link.

No hosted Neon migration, Cloudinary live check, deployment, browser dependency or payment/customer integration is performed. Existing Workers/Sharp/Next/PostgreSQL runtime compatibility limits remain unverified. This phase stops at the persistent guest bag.

## Phase 08: Egypt checkout preparation

Migration `0010_checkout_drafts.sql` adds one disposable personal-details record per guest cart. It does not add to or alter financial history. The UUID record references `carts` with cascading deletion and an optional existing `boutique_locations` record with `ON DELETE SET NULL`. It stores only contact details, the two existing fulfillment values, the relevant Egyptian delivery address or collection location, a non-personal cart/location fingerprint, and creation/update/expiration timestamps. Switching methods clears details belonging to the previous method. No cart lines, money, customer account, order, payment, reservation or arrangement is created.

`GET /api/checkout` loads the current owned cart and optional draft. `POST /api/checkout/draft` explicitly saves, `DELETE /api/checkout/draft` explicitly clears, and `POST /api/checkout/review` validates without saving personal details. The `/checkout` page uses these private, no-store responses; its initial HTML contains no customer data. The existing HttpOnly guest-cart cookie is the sole credential. Ownership is resolved from its hash with an owner-cart row lock in the same transaction as draft access; browser IDs and prices are never accepted. Draft revision checks prevent stale tab overwrites. Public catalogue credentials have no checkout-draft access.

For the existing `CART_DATABASE_URL` service role only, add `SELECT, INSERT, UPDATE, DELETE ON checkout_drafts` and `SELECT ON boutique_locations` to its existing cart/catalogue grants. Do not grant draft access to the public reader. This service role enforces per-guest ownership through the repository; these grants are not an RLS policy for arbitrary client SQL. Continue to keep service credentials server-only and use verified database TLS in hosted environments. Local test grants use independently restricted, disposable roles. Apply the migration and grants through the established operator workflow; this phase does not run remote migrations.

The server reuses the authoritative cart snapshot for every load/save/review and again before readiness. A fingerprint includes current lines, quantities, prices, availability and active location details. Changes invalidate earlier readiness and preserve unsaved input for review. `CART_REVIEW`, `CUSTOMER_DETAILS`, `FULFILLMENT` and `REVIEW_READY` describe preparation only. Even review-ready details do not establish an order or reserve jewelry. EGP amounts remain exact integer-minor-unit strings; the displayed subtotal is not represented as a final payable total. No fees, dates or delivery zones are invented.

Names, email, phone and delivery fields are bounded and normalized server-side. Private Delivery requires a controlled one-of-27 governorate selection, city/area and street; building, floor/unit and instructions are bounded optional refinements. Only country `EG` is accepted. Mobile input accepts conventional domestic, `+20` and `0020` forms, Arabic/Persian digits and common spacing, and normalizes to `+201[0125]` followed by eight digits. This validates format only and does not verify identity or ownership. Sources: [ITU publication of Egypt's NTRA mobile numbering plan](https://www.itu.int/dms_pub/itu-t/opb/sp/T-SP-OB.1133-2017-OAS-PDF-E.pdf) and [Egypt State Information Service governorate reference](https://sis.gov.eg/en/egypt/basic-information/). Collection reads only active Egyptian database locations; no location is seeded by this phase. Inactive, missing or no-longer-current selections are rejected. When none exist, collection is visibly unavailable. Test location records are explicitly synthetic and confined to disposable databases.

### Personal draft retention and deletion

A saved draft has a fixed maximum lifetime of 24 hours from its first save, capped by its cart's expiration. Subsequent saves do not extend it. Expired drafts are inaccessible immediately, including through previously valid guest cookies. Reads and mutations opportunistically purge bounded batches of expired drafts and drafts whose carts have expired, become inactive or acquired a customer identity. Customers can clear their saved data explicitly. Unsaved review never persists contact or address data; the page keeps it only in memory, without local/session storage, URLs or broadcast messages.

**Before enabling production draft saving**, schedule and monitor `npm run checkout:purge` at least hourly with the restricted `CART_DATABASE_URL`. The command physically deletes expired/inactive personal draft records only, uses bounded batches (up to 10,000 rows per invocation with `SKIP LOCKED`), closes its pool, and logs only a deletion count or a generic failure. Monitor failures/backlog and increase invocation frequency if necessary. With a healthy hourly job and no backlog, physical removal occurs within one hour after the fixed 24-hour expiry; access ends at expiry regardless. Backups and infrastructure logs require their own operator retention policy; no personal draft content should be logged. Request-time expiry alone does not guarantee physical erasure while the website is idle.

`CHECKOUT_DRAFT_RETENTION_READY=false` is the safe production default in `.env.example`. Set it to exactly `true` only after the purge job is scheduled and monitored; clear it if that operational requirement is no longer met. The flag acknowledges configuration; it does not create or verify a scheduler. In production, a missing/false flag disables the Save draft button and rejects save mutations without personal writes. Review without saving, existing-draft access until expiry, and explicit deletion remain available. Local disposable tests explicitly enable saving and verify the real purge command. No scheduler, hosted cron, hosted database change or paid service is provisioned here.

### Phase 08 verification

`npm run test:checkout` covers validation, ownership, stale revisions/context, expiry and physical deletion, exact arithmetic, safe production defaults and unchanged financial/inventory records against disposable PostgreSQL. `npm run test:checkout:browser` covers desktop/mobile delivery, restore/review, collection changes, cart/price changes, isolation, expiry and keyboard/error focus. It reuses the existing browser harness, `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE` and temporary TLS configuration; screenshots must remain outside the repository and be removed after inspection. Run checkout/cart/admin/catalogue-admin browser suites sequentially because they share local ports. Existing service and public browser suites remain required. Homepage comparison now includes the entire header and bag, without the earlier Phase 07 bag mask, at the existing raster tolerance.

This phase adds no dependency and stops at preparation. Live Neon/Cloudinary checks, Workers compatibility, production migration/grant/retention setup, actual boutique location configuration and payment/order initiation remain operator or later-phase work. No Paymob call, customer registration, inventory reservation, delivery appointment or purchase confirmation is implemented.

## Phase 09: test-mode orders, Paymob and stock reservations

This implementation is **test mode only**, disabled by default, and is not a production release. It uses the existing financial and inventory tables, guest cart and checkout store. Migration `0011_test_payment_lifecycle.sql` adds correlation, guest-access, immutable collection snapshots, initiation/maintenance metadata and verified-event fields. It preserves all earlier migrations/checksums, source-cart uniqueness, financial-history foreign keys and existing checked order/payment/reservation statuses. New transactions are explicitly `test_mode=true`; legacy financial records are excluded from this runtime. No dependency, hosted migration, deployment, account registration, courier, delivery scheduling or automatic refund is introduced.

### Verified Paymob contract

The official documentation was inspected on 2026-10-27: [API flow](https://developers.paymob.com/paymob-docs/integration-paths/apis), [Create Intention](https://developers.paymob.com/paymob-docs/intention-apis/create-intention), [Unified Checkout](https://developers.paymob.com/paymob-docs/developers/checkout-experiences/unified-checkout-redirection), [transaction callbacks](https://developers.paymob.com/paymob-docs/manage-callback/transaction-callbacks), [HMAC overview](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac), [exact processed-callback HMAC](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback), [credentials](https://developers.paymob.com/paymob-docs/need-help/setup-guides/getting-integration-credentials), [API authentication](https://developers.paymob.com/paymob-docs/developers/authentication-request-generate-auth-token-1), and [inquiry by merchant reference](https://developers.paymob.com/paymob-docs/developers/transaction-inquiry-apis/transaction-inquiry/by-order-id-or-reference).

The adapter posts to the fixed Egyptian endpoint `https://accept.paymob.com/v1/intention/` using `Authorization: Token <test-secret-key>`. It sends the authoritative EGP amount, one configured test integration, minimal required billing contact, a stable random attempt reference as `special_reference`, expiration, and fixed same-origin callback/return routes. Optional item/extras metadata is omitted: full line snapshots remain local, and no customer data is copied into custom metadata. The response must match the amount, currency, special reference and configured integration, contain test-prefixed intention/client-secret identifiers, and report `live=false`. Only whitelisted values are retained; raw provider responses/card fields are not stored.

Current official Egypt Unified Checkout is `https://eg.checkout.paymob.com/?publicKey=...&clientSecret=...`; it is not inferred from older examples using the acceptance API host. The server constructs this fixed destination, and the browser checks the same host/path/parameters. API base/redirect hosts cannot be supplied by customers or environment overrides. Requests have a 12-second timeout, refuse redirects and bound response JSON to 64 KiB. The positive JSON number accepted by the provider must fit `Number.MAX_SAFE_INTEGER`; local order/cart arithmetic remains exact BIGINT/integer minor units, and larger amounts fail before any reservation or provider request. The existing database's zero discount/tax/fee defaults are used for this **test** order; no business fee policy or production pricing approval is implied.

The processed callback uses exactly Paymob's documented twenty-field order, concatenated values and HMAC-SHA512, with a length-checked constant-time comparison. Its signed `order.id`, `integration_id`, `owner`, amount and currency bind it to the stored attempt. `merchant_order_id`, `is_live`, refund amounts and other unsigned fields are not independent authentication evidence. In particular, unsigned merchant metadata cannot attach an unknown callback to a local order. The supplementary `is_live=false` check is backed by test-only credentials, authenticated intention validation and signed integration/owner/reference matching. Unknown authenticated references are retained as minimal unmatched business events and receive a non-success response until processed. The official canonical-string example is a permanent test fixture; the published secret is redacted, so its displayed digest cannot be reproduced. Tests sign synthetic callbacks with a separate fixture-only secret. No real card data or merchant credentials are in fixtures.

### Routes and customer access

- `POST /api/payments/initiate`: exact-Origin, owned saved checkout, fingerprint and microsecond draft revision; no browser IDs or totals.
- `POST /api/payments/paymob/callback?hmac=...`: authenticated processed transaction callback, bounded JSON, dedicated shared database rate counter; no browser session or Origin requirement.
- `GET /api/payments/paymob/return/[reference]`: discards all query claims and redirects to the fixed same-origin order page. It never changes financial state.
- `GET /api/orders/[reference]`: private, no-store, owner-checked status and minimal snapshotted selection/destination.
- `POST /api/orders/[reference]/payment`: safely resume an undispatched/available existing attempt or retry a known failed attempt using its durable previous-attempt reference.
- `/orders/[reference]`: dynamic shell, no personal data in HTML/RSC, no-index and no-referrer; reads authoritative private API data. A redirect alone always leaves payment pending.

The existing HttpOnly/Secure/Lax guest cookie is the only customer credential. Order access additionally pins its hash and original expiry to the immutable order, requires a current active unexpired guest cart with that hash, and checks a random order UUID. A UUID/order number alone grants no access. Guest status access ends when the cookie/session expires or is revoked; there is no unsecured recovery lookup. Responses never include raw session tokens, service credentials, provider secret keys or card details. The provider's intention-specific client secret is sent only in its required hosted-checkout URL to the authenticated initiating customer. It stays in the restricted payment table only for the short resume window and is cleared on terminal handling/maintenance. Order pages and return responses suppress referrers; no analytics are added.

`GET /api/checkout` additionally provides an owned pending-order link, including unresolved exceptions. This lets a guest recover after a lost initiation response, even when that order's hold makes its original cart selection unavailable. Unsaved/review-only details cannot initiate payment: the current validated form must match the saved draft and its reviewed context. The Phase 08 production retention gate remains mandatory. Payment availability exposes a boolean only; missing credentials do not cause unrelated homepage database operations or prevent builds.

### Transactions, snapshots and stock ownership

All payment work uses a separate lazy `PAYMENT_DATABASE_URL` pool, never the administrator, owner or public-reader pool. A guest-specific PostgreSQL transaction advisory lock coordinates this lifecycle across instances, followed by current-cart/order/payment locks. Selected products/variants/prices are share-locked, and inventory rows are update-locked in deterministic ID order. The server re-reads the authoritative cart and saved draft after locks, validates location activity/contact/price/quantity/stock, and checks `inventory.reserved` against active reservation sums. Inconsistent ledgers fail closed before charging.

One short transaction creates the pending order, immutable names/SKU/configuration/quantity/prices/contact/destination snapshots, payment attempt and payment-owned inventory reservations. An insertion failure rolls everything back. Holding stock increases only the existing `reserved` counter; it never deducts `on_hand`. A durable `LOCAL_READY → DISPATCHING` claim commits before external HTTP. No Paymob request occurs under database row locks. There is exactly one create request per claimed attempt; `special_reference` is correlation, not an assumed provider idempotency guarantee. Repeated submissions return the existing order/attempt. An ambiguous timeout, malformed response, lost response or interrupted dispatch is never automatically retried as another intention.

Reservations reference both their order and payment attempt, with composite ownership and uniqueness constraints. A verified standalone non-pending success consumes only that attempt's ACTIVE holds, decrements `on_hand` and `reserved` together once, and records `inventory_finalized_at`. Duplicate/out-of-order callbacks cannot repeat it. A verified failure or documented provider rejection releases only that attempt's holds, without deducting physical stock. Runtime grants make financial/contact/destination/item snapshots immutable.

The original unique `orders.source_cart_id` constraint is retained. On terminal handling, the original cart becomes converted; a new ordinary cart inherits the same token hash, expiry and remaining selections, so the browser keeps the same cookie and existing cart store. Only purchased lines whose ID, quantity and full-precision update timestamp remain unchanged are removed. Added/edited selections and newer checkout details are preserved. Historical source carts/orders remain linked and cannot cascade-delete financial records. An existing unresolved payment or critical exception blocks another payment for that guest. Known failed retries create one uniquely linked child attempt, revalidate the original price/configuration/publication/stock and collection snapshot, and reserve afresh without altering order history.

### State machine and late outcomes

| Condition | Attempt/local state | Order/stock effect |
| --- | --- | --- |
| Committed, not sent | `CREATED / LOCAL_READY` | `PENDING_PAYMENT / PENDING`; active hold |
| Request dispatched | `PENDING / DISPATCHING` | no second create request; short dispatch lease |
| Verified intention | `PENDING / READY` | bounded local resume URL; awaiting result |
| Unknown outcome/stale dispatch | `PENDING / UNCERTAIN` | reconciliation flag; stock remains held |
| Verified standalone success with owned holds | `SUCCEEDED` | `CONFIRMED / PAID`; stock consumed once; fulfillment remains `UNARRANGED` |
| Verified failure/definitive rejection | `FAILED` | `CANCELLED / FAILED`; hold released once; safe retry may be offered |
| Operator-confirmed provider closure, unpaid | `CANCELLED` | no automatic financial refund; own hold released after checks |
| Late success after release | `SUCCEEDED` plus `LATE_SUCCESS` flag | paid history preserved; no replacement stock consumed; no fulfillment confirmation |
| Another success/unsupported financial action | durable verified event plus reconciliation flag | no second deduction; no automatic refund or restock |

Authorization-only, capture/parent, refund and void cases are flagged for manual review instead of being guessed as ordinary successful standalone charges. Exact refund amounts are not trusted from unsigned callback fields; refund/partial-refund management is not implemented. Earlier success cannot be overwritten by a later failure. A paid late exception remains visible to the customer and operator, even if its order is cancelled. If another attempt already owns a hold, the late attempt cannot consume it. A subsequently verified duplicate-paid attempt releases only its own otherwise-blocked holds and retains the duplicate-charge exception; no jewelry is automatically allocated or fulfilled for that exception.

### Expiry, reconciliation and operator commands

A reservation has an explicit 15-minute timestamp; expiration is not a payment-failure signal and never makes its units automatically available. The locally bounded checkout-link window is also not proof of provider closure. An expired attempt still in `LOCAL_READY` can be safely released because no dispatch was claimed. A dispatched/uncertain attempt requires authenticated provider inquiry or documented operator confirmation before release. A still-held expired reservation may be consumed by a verified success because those units were never reallocated. Provider-not-found, network failure or `pending=true` cannot authorize release.

The adapter obtains an inquiry token with `POST /api/auth/tokens` and the shared API key, then calls `POST /api/ecommerce/orders/transaction_inquiry` with the local merchant reference. It verifies returned reference, owner/integration, amount, currency and test mode before binding an unknown provider order or processing the result. Inquiry data is authenticated by the fixed provider HTTPS API, not falsely labelled HMAC-verified. These read-only checks do not create, cancel or refund payments. Paymob's inquiry returns the last transaction: it is not assumed to enumerate every possible transaction or prove an intention closed.

Use the following from a trusted operator environment with the restricted payment role and test credentials. Never expose these commands as an unauthenticated web endpoint:

```text
npm run payments:reconcile -- list 25
npm run payments:reconcile -- run 10
npm run payments:reconcile -- inspect PAYMENT_UUID
npm run payments:reconcile -- close-unpaid PAYMENT_UUID NON_PERSONAL_EVIDENCE_REFERENCE --confirm-provider-closed-unpaid
```

`list` includes pending/flagged attempts and unmatched authenticated callbacks, using private financial references/reasons and no contact/address/card data. `run` claims a bounded batch (default 10, maximum 50), uses database leases/`SKIP LOCKED`, performs provider HTTP outside transactions, and reports claimed/checked counts. **Checked does not mean resolved**: run `list` afterward and monitor remaining exceptions. Multiple workers may repeat a read-only inquiry after a lease expiry; durable events and state transitions remain idempotent. Use a smaller batch when required by a job runtime's time limit.

`inspect` supports any explicit test attempt, including a closed attempt whose provider identity was unknown. For an unmatched late callback, use its provider reference in the merchant dashboard to identify the genuine local reference, then inspect that local attempt; unsigned callback metadata is never the binding authority. Correlated stored events are replayed safely. `close-unpaid` requires a non-personal evidence reference and an explicit trusted operator attestation that the merchant dashboard/provider investigation confirmed the intention is closed, there is no pending provider activity and no funds were received. It performs a fresh inquiry, refuses processing/success/review states and active dispatch/maintenance leases, preserves history and cannot cancel a verified paid attempt. A not-found response by itself never authorizes closure. This command does not cancel anything at Paymob; the operator must have already established closure there. Any contradictory late success is retained and flagged, not hidden.

Before enabling initiation, schedule and monitor reconciliation at least every minute, choose a batch/frequency that clears the expected load, alert on failed jobs and expired/stale holds, and assign an operator to investigate unresolved cases promptly (escalate within an hour). A provider outage or unprovable closure must not be resolved by freeing possibly paid stock. Disable new initiation if monitoring or operator coverage fails; keep callback/inquiry configuration available until outstanding transactions are settled. There is no automatic cron provisioned here. Reliable future free-hosting execution, webhook reachability and exception coverage remain **production release blockers**; neither local timers nor the readiness flag prove a hosted scheduler is running. Financial-history/backup retention requires a separate business policy; the 24-hour personal-draft policy does not delete financial snapshots.

### Configuration and database grants

`.env.example` contains placeholders only. Both `PAYMENTS_TEST_ENABLED` and `PAYMENTS_RECONCILIATION_READY` default false. Initiation requires exact `PAYMOB_MODE=test`, validated test-prefixed secret/public keys, test integration ID, the signed callback's `obj.owner` account-user ID, HMAC secret, read-only-inquiry API key, dedicated payment database URL, valid `CART_ORIGIN` and the Phase 08 retention acknowledgement. Live mode/live-prefixed credentials are rejected with no fallback. Verification/reconciliation remain available when only the initiation gate is disabled. Do not rotate the single configured HMAC/owner/integration identity while attempts remain unresolved without a separately reviewed migration/rotation plan.

After applying 0011 through the established local/operator migration workflow, grant the illustrative runtime role below. Keep the public reader, guest cart and admin roles separate. Do not use an owner/migration credential at runtime:

```sql
GRANT USAGE ON SCHEMA public TO payment_runtime;
GRANT SELECT ON products,product_variants,product_prices,product_media,inventory,boutique_locations,carts,cart_items,checkout_drafts,
  orders,order_items,order_addresses,payments,payment_events,inventory_reservations,order_status_history TO payment_runtime;
GRANT UPDATE(updated_at) ON products,product_variants,product_prices,boutique_locations TO payment_runtime;
GRANT INSERT ON carts,orders,order_items,order_addresses,payments,payment_events,inventory_reservations,order_status_history TO payment_runtime;
GRANT UPDATE(status,session_token_hash,updated_at) ON carts TO payment_runtime;
GRANT UPDATE(cart_id) ON cart_items TO payment_runtime;
GRANT DELETE ON cart_items,checkout_drafts TO payment_runtime;
GRANT UPDATE(cart_id,updated_at) ON checkout_drafts TO payment_runtime;
GRANT UPDATE(on_hand,reserved,updated_at) ON inventory TO payment_runtime;
GRANT UPDATE(order_status,payment_status,inventory_finalized_at,reconciliation_required,reconciliation_reason,updated_at) ON orders TO payment_runtime;
GRANT UPDATE(provider_order_reference,provider_intention_reference,provider_transaction_reference,status,succeeded_at,initiation_state,
  checkout_client_secret,checkout_resume_until,next_reconcile_at,reconcile_lease_until,reconcile_attempts,last_error_code,updated_at) ON payments TO payment_runtime;
GRANT UPDATE(status,ended_at,updated_at) ON inventory_reservations TO payment_runtime;
GRANT UPDATE(payment_id,status,processing_attempts,last_error_code,processed_at) ON payment_events TO payment_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON cart_rate_limits TO payment_runtime;
```

Timestamp-only catalogue/location UPDATE grants satisfy PostgreSQL's `FOR SHARE` row-lock privilege check; the runtime never changes their price, publication, SKU or address fields. Financial/item/address/contact amounts are not updateable and financial/history deletes are not granted. These are server-service grants, not a substitute for per-guest authorization or a client SQL/RLS interface. Use verified database TLS on hosted connections. Existing admin stock adjustments preserve reserved units and cannot reduce physical stock below them.

### Verification boundary

Run `test:payments` and `test:payments:browser` alongside every existing service/browser suite, lint, TypeScript and a build with database/media/payment settings empty. Payment tests cover real disposable PostgreSQL locking/constraints/rollbacks, HMAC ordering/tampering, cross-session access, exact arithmetic, retries, uncertain outcomes, lease recovery, late success, immutable grants, retention/test gates, operator output and absence of stored card/contact callback fields. Browser tests use the existing HTTPS harness and a test-only preload; official hosted redirects are intercepted by a clearly labelled mock page, and authenticated synthetic callbacks exercise the real handler. No real sandbox transaction, card entry, merchant account or provider settlement is claimed. Screenshot/log/TLS/database artifacts are temporary and must be inspected/removed. Run payment, checkout, cart, admin and catalogue-admin browser suites sequentially because they share ports. No browser package is added.

Actual merchant sandbox credentials, integration/owner configuration, provider response/expiry behavior, publicly reachable callbacks, refunds/authorization exceptions, key rotation, fee-policy approval and future Workers/scheduler compatibility still require operator verification. Do not enable live payments or declare production readiness. This phase stops before full order/fulfillment management in Phase 10.

## Phase 10: order and personal fulfillment administration

`/admin/orders` and `/admin/orders/[id]` reuse the existing administration shell. OWNER and ADMIN receive `orders:read`, `orders:manage_fulfillment` and `orders:view_payment_exceptions`; catalogue-only and disabled staff have no order, customer, address, exception or audit access. Every repository operation authorizes against the signed session and rechecks the enabled database identity inside the transaction. The administrator row is share-locked until commit. Roles or actor IDs submitted by a browser are never accepted.

`POST /api/admin/orders/search` accepts exact order reference, payment/fulfillment/method filters and UTC creation dates in JSON, keeping personal data out of URLs. Page size is 1–50 (default 20), page 1–1000, with `created_at DESC,id DESC` ordering and one extra row to determine the next page. Lists return customer name only, without contacts, address or provider data. `GET /api/admin/orders/ORDER_UUID` returns protected details and histories. `POST` to that same path records a single operation. Responses are private/no-store; mutations and searches require exact origin, reject cross-site requests, have an 8 KiB streamed-body limit, reject extra fields, and share a per-admin 100/minute throttle. No export, reconciliation HTTP endpoint or payment-status editor exists.

### Schema and canonical transitions

Migration `0012_order_fulfillment_administration.sql` extends existing tables only. It adds preparation/arranging/readiness to the canonical order fulfillment stage and matching history constraint. Existing arrangement statuses remain REQUESTED, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED and RESCHEDULED. Events gain an order reference (backfilled for existing records), durable operation identity/fingerprint, controlled failure reason/follow-up and same-order corrective references. Order-only notes/acknowledgments/corrections may have no arrangement; other events require one. Same-order FKs, one handover per order, and existing single-current-arrangement constraints preserve history. A creation-time index supports list ordering. Migrations 0001–0011 are unchanged.

| Operation | Required order stage | Resulting order stage / arrangement lifecycle |
| --- | --- | --- |
| Prepare | UNARRANGED or CANCELLED, no current arrangement | PREPARING / new REQUESTED arrangement |
| Record contact | PREPARING | ARRANGING / REQUESTED |
| Propose appointment | ARRANGING | ARRANGING / REQUESTED with proposed UTC times |
| Confirm customer agreement | ARRANGING with proposed times, explicit confirmation, enabled operational assignee | SCHEDULED / CONFIRMED |
| Out for personal delivery | SCHEDULED, Private Delivery | IN_PROGRESS / IN_PROGRESS |
| Ready for collection | SCHEDULED, Boutique Collection | READY / IN_PROGRESS |
| Record handover | IN_PROGRESS for delivery or READY for collection, explicit confirmation | COMPLETED / COMPLETED; operational order status COMPLETED |
| Reschedule | Any active noncompleted arrangement | Old RESCHEDULED; successor REQUESTED with proposed times; order ARRANGING |
| Unsuccessful attempt | SCHEDULED, IN_PROGRESS or READY | Old RESCHEDULED with attempt event; successor REQUESTED without confirmed time; order ARRANGING |
| Cancel arrangement | Any active noncompleted arrangement | CANCELLED / CANCELLED; no financial cancellation, refund or stock release |
| Note, exception acknowledgment, corrective event | Authorized order access; acknowledgment requires a Phase 09 reconciliation flag | Append-only observation; no fulfillment or financial override |

All normal progression, rescheduling, unsuccessful attempts and arrangement cancellation require PAID, CONFIRMED, finalized purchased inventory, no reconciliation flag, and a matching SUCCEEDED payment with processed authenticated provider evidence for the same amount, currency and transaction. Completion cannot start preparation or manufacture financial success. Handover records the server-authenticated actor, actual timestamp, confirmed recipient, order/arrangement and method; no identity number, document image or tracking number is requested. Timestamps cannot predate the order; attempts allow at most five minutes of clock skew into the future. Notes are bounded to 1,000 characters. Failed attempts require a controlled reason and follow-up. Corrections reference a same-order original event and append a note without editing it. Completed arrangements, recipient and completion time remain immutable through the application.

The order snapshot remains the authority for SKU, name, configuration, quantity, EGP minor-unit prices/totals, contact and destination. Boutique configuration changes never replace the checkout destination; changed details are flagged. An inactive/missing original boutique blocks confirmation, readiness and handover, while preserving history and allowing issue/follow-up records. No location replacement editor is added. Appointment inputs explicitly use device local time and preview `Africa/Cairo` through Intl before submitting UTC instants. Appointment confirmation is manual and sends no notification.

### Transactions, financial boundaries and privacy

Each operation share-locks the authorized identity, locks the order then current arrangement, validates a microsecond revision and eligibility, updates operational state, appends event/status history and inserts audit in one PostgreSQL transaction. Audit failure rolls everything back. The order lock is shared with Phase 09 callbacks, serializing financial truth with eligibility. Revisions advance monotonically. A unique operation UUID plus SHA-256 of normalized action, fields, revision, order and authenticated actor gives durable retries: identical replays return success without duplicate events/audits; reused IDs with different content and stale new operations conflict. Unique handover/current-arrangement indexes are additional guards. There are no provider calls inside these transactions and no inventory/payment writes in the fulfillment repository.

Payment/stock exceptions come from Phase 09 reconciliation state, with additional visible refund/unfulfillable-PAID indicators. Acknowledgment appends a responsible-staff event and audit without clearing the flag, changing money, refunding or moving inventory. Existing reconciliation remains the trusted operator CLI described above. Payment history selects explicit safe columns; neither raw verified payloads, client secrets, card fields nor guest hashes enter admin DTOs. Audit metadata contains bounded references, stages, proposed/confirmed times and assignee only, never recipient/contact or note text. Internal notes live in protected event history. The customer page reuses the existing ownership-checked fulfillment stage and displays preparation/arrangement/readiness/handover messages; its endpoint and guest-session checks are unchanged and expose no internal events, staff or diagnostics.

Add the following privileges to the **existing** server-side `ADMIN_DATABASE_URL` role through the established operator workflow after 0012. `catalogue_admin_runtime` is the illustrative existing role name from Phase 06, not a new connection/service. Keep all Phase 05 authentication and Phase 06 catalogue grants. PostgreSQL requires UPDATE on one column to take row share locks; timestamp-only grants do not permit role/activation/location edits.

```sql
GRANT SELECT(id,order_number,customer_name,customer_email,customer_phone,currency,total_minor,subtotal_minor,discount_minor,tax_minor,
  fulfillment_fee_minor,payment_status,order_status,fulfillment_method,fulfillment_status,created_at,updated_at,test_mode,boutique_location_id,boutique_location_snapshot,
  inventory_finalized_at,reconciliation_required,reconciliation_reason) ON orders TO catalogue_admin_runtime;
GRANT UPDATE(fulfillment_status,order_status,updated_at) ON orders TO catalogue_admin_runtime;
GRANT SELECT ON order_items,order_addresses,boutique_locations,fulfillment_arrangements,fulfillment_events,order_status_history TO catalogue_admin_runtime;
GRANT UPDATE(updated_at) ON admin_users,boutique_locations TO catalogue_admin_runtime;
GRANT SELECT(id,order_id,status,currency,amount_minor,refunded_minor,provider_transaction_reference,created_at,succeeded_at,initiation_state,last_error_code)
  ON payments TO catalogue_admin_runtime;
GRANT SELECT(id,payment_id,status,signature_verified,verification_source,provider_transaction_reference,received_at,processed_at)
  ON payment_events TO catalogue_admin_runtime;
GRANT INSERT ON fulfillment_arrangements,fulfillment_events,order_status_history TO catalogue_admin_runtime;
GRANT UPDATE(status,scheduled_start_at,scheduled_end_at,assigned_admin_id,completed_at,completed_by_admin_id,updated_at)
  ON fulfillment_arrangements TO catalogue_admin_runtime;
```

Do not add payment UPDATE, order money/payment/reconciliation/stock-finalization UPDATE, order snapshot edits, or event/audit UPDATE/DELETE grants. These are trusted server-service grants; human roles are enforced in every repository/HTTP boundary, not by giving browsers database SQL access. Existing catalogue inventory permissions continue to serve catalogue administration; this order implementation never invokes them. No public-reader, guest-cart or payment-role grant changes are needed for Phase 10.

### Local verification and remaining operational setup

Run `npm run test:orders` alongside all existing integration suites against explicit disposable loopback `TEST_DATABASE_URL`. `npm run test:orders:browser` reuses the temporary TLS/Playwright configuration and must run sequentially with other admin/cart/checkout/payment browser suites sharing ports. Browser plugin not available: the fallback uses the existing cached Playwright and Chromium, with no dependency installation. Fixture orders follow real cart, checkout, payment-initiation and signed callback handlers against a synthetic provider; no PAID rows are fabricated or real merchant traffic generated. Browser tests cover desktop/mobile workflows, filters, conflicts, exceptions, role restrictions and private customer status. Existing storefront browser verification compares the starting homepage at desktop/mobile sizes and exercises catalogue/cart navigation. Keep all screenshots, logs, certificates and disposable databases outside the repository and remove them after inspection.

Runtime migration/grant deployment, actual Paymob sandbox verification, hosted database/runtime/scheduler compatibility and operational staffing remain unverified operator work. Live payments stay disabled. There is no deployment, hosted migration, real transaction, refund, courier, notification or customer-account feature. Local verification does not establish production readiness.

Phase 10 local verification completed on 2026-10-27: 209 integration tests (40 new order cases) and 41 browser tests (6 new order cases), all passing; 250 total. Lint, TypeScript and the production build passed with database/media/payment settings empty. Desktop 1440×1000 and mobile 390×844 browser checks passed. The original pre-edit full-page homepage references and final captures used the same protocol: decoded pixels matched exactly at both sizes. The optional viewport-baseline comparison was not used for the final public suite because the starting references were full-page captures; its tolerance/assertions were unchanged. Original migration, payment-lifecycle and approved source/asset hashes are checked separately before cleanup. All databases, roles, screenshots, certificates and logs used for this verification are disposable local fixtures; no real Paymob sandbox transaction was executed.
