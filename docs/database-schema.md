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
