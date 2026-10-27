# PostgreSQL database foundation — Phase 01

Schema only: Neon PostgreSQL Free is the intended provider; no hosted database was contacted. SQL uses standard PostgreSQL facilities, UUID primary keys with built-in `gen_random_uuid()`, exact `NUMERIC(12,4)` gemstone weights, `BIGINT` money in minor units, and `TIMESTAMPTZ`. No extensions, ORM, database client, API, authentication, external integration, or UI changes were introduced. PostgreSQL 17.10 was used for execution validation.

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
| `schema_migrations` | Applied filename/version and timestamp; infrastructure, not a customer-facing domain. |

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

Use `psql` with `-X` and `ON_ERROR_STOP=1`; each migration commits its ledger entry in the same transaction as its DDL. A failure rolls that migration back. There is no `IF NOT EXISTS` masking an incompatible schema. Do not reapply a recorded migration. Run one migration operator at a time. The ledger tracks versions/filenames, not content checksums: use reviewed, version-controlled files. Once applied to any persistent environment, freeze the file and make corrections in a new numbered migration. Temporary disposable development validation does not publish a migration.

Example PowerShell, from the repository root, targeting an **empty disposable local database** on an already running development instance. Set the binary directory, port and local role to your own installation. Authentication uses your local PostgreSQL configuration; no connection string or password belongs in this repository. `createdb` fails if the name already exists; do not bypass that guard against an existing database.

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$pgPort = 5432
$pgRole = 'postgres' # Local database role, not a seeded application admin.
$databaseName = 'lapalme_schema_check'
& "$pgBin\createdb.exe" --host=127.0.0.1 --port=$pgPort --username=$pgRole $databaseName
if ($LASTEXITCODE -ne 0) { throw 'Could not create a fresh local database' }

foreach ($file in (Get-ChildItem db/migrations/*.sql -File | Sort-Object Name)) {
    & "$pgBin\psql.exe" -X --host=127.0.0.1 --port=$pgPort --username=$pgRole `
        --dbname=$databaseName --set=ON_ERROR_STOP=1 --file=$($file.FullName)
    if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($file.Name)" }
}

& "$pgBin\psql.exe" -X --host=127.0.0.1 --port=$pgPort --username=$pgRole `
    --dbname=$databaseName --set=ON_ERROR_STOP=1 --file=db/tests/schema-verification.sql
if ($LASTEXITCODE -ne 0) { throw 'Schema verification failed' }

& "$pgBin\psql.exe" -X --host=127.0.0.1 --port=$pgPort --username=$pgRole `
    --dbname=$databaseName --command='SELECT version, filename, applied_at FROM schema_migrations ORDER BY version;'
```

On an interrupted local application, inspect that ledger and apply only subsequent, unrecorded files; do not rerun the empty-database loop. The test uses one transaction and a temporary helper; it rolls back fixtures on success, and `psql` disconnect rolls back on error. It is for disposable databases, not production. Unix installations can use the equivalent `createdb`/`psql` commands with the same flags and ordered files. After inspection, remove only your explicitly named disposable database/cluster through the local PostgreSQL tools.

## Verification boundary

All five migrations were applied to a fresh PostgreSQL 17.10 cluster bound to loopback, separate from the installed database service. The rollback-only test checks catalogue uniqueness, exact data types, indexed foreign keys, stock guards, guest records, historical snapshots, currency/reference integrity, retry/event deduplication, both fulfillment methods, rescheduling, responsible handover and bounded audit data. Foreign-key delete actions and partial unique indexes were inspected. All 30 business tables were confirmed empty after rollback. Frontend lint, TypeScript checking and production build passed; existing source, configuration, assets and Phase 00 files were preserved.

Remaining validation belongs to later implementation phases: concurrent purchases, authenticated/out-of-order/late Paymob callbacks, transaction retries, authorization/privacy controls, persistent-environment migration automation, actual Neon connectivity and Cloudflare runtime compatibility. No integration readiness is implied by these schema checks.
