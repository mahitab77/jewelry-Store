# Phase 11 release readiness — 2026-10-28

## Quotation-only model — local implementation, not deployed

The working tree extends the uncommitted admin simplification with one server-only
quotation policy, one shared guest request workflow and one operations inbox.
No Cloud Run, Neon, IAM, Secret Manager, Cloudinary or payment-provider operation
was performed. The reported healthy staging v3 remains the rollback baseline;
these local changes are not present there until a separately approved release.

The new release defaults to quotation-only. Do not set private
`COMMERCE_MODE=DIRECT_SALES` without a separate commercial/security review. Missing
and invalid values fail closed; no NEXT_PUBLIC or customer parameter enables sales.
Existing commerce regression fixtures explicitly exercise DIRECT_SALES, while the
new policy suites prove default-denial even with other payment flags enabled.
Keep Paymob and checkout retention readiness disabled on staging.

One additive migration0013 introduces nullable exact metal grams/basis, selected
request configurations, consultation channel and bounded original design context;
no new business tables or dependencies. Existing0001–0012 and approved role SQL
bytes/checksums remain unchanged. The fresh-database offline preparation tool now
verifies the complete thirteen-file manifest. **Its fresh-only review must not be
used against the existing Neon database.** Hosted0012→0013 needs its own reviewed,
target-pinned incremental procedure and separate operator approval. Do not replay
historical role provisioning. The new staging-request-grants.review.sql likewise
requires separate approval after migration/ledger verification; it grants only
request-table SELECT and documented INSERT/UPDATE columns to the existing app role.

Request submission collects name, email/telephone, message, selected piece and
optional preferred Cairo time. Zoom requires email. No customer registration,
profile, shopping cart, attachment or financial record is created. Staff manually
checks /admin/requests; operations:manage is required at every boundary and the
existing CATALOGUE_MANAGER account is not upgraded. Successful submission means
receipt only. No automatic email, firm quotation or meeting confirmation is promised.

Launch gates: name an operations-authorized employee; verify outbound customer
contact; approve personal-data retention/replay periods; assign consultation
confirmation responsibility. No guessed purge period, anonymous status lookup,
unrestricted DELETE grant, email service or background worker is introduced.
An approved retention procedure must handle dependencies, preserve non-PII audits
and explain that purged requests no longer provide durable duplicate protection.

The original request snapshot intentionally excludes prices, private certification
fields, descriptions and image bytes; it preserves selected public specifications,
not an archived photographic record. Existing image upload/delivery/cleanup is reused.
Live Cloudinary credentials/configuration and real upload/delivery/retirement tests
remain separately authorized; customer inspiration uploads are deferred.

Future deployment must preserve canonical origins, credentials, resources, public
invocation, noindex and disabled payments. Record the previous healthy revision and
digest before applying an approved immutable image. Rollback service traffic first;
leave additive schema, received requests and financial history intact. Original v3
lacks the quotation guard, so retain a healthy quotation-only revision as the
preferred subsequent rollback target. Existing issued payment intentions require
normal verified settlement/reconciliation; policy changes never justify releasing
uncertain holds. Continue the existing operator checkout-draft purge where relevant:
quotation-mode early returns do not perform opportunistic checkout retention work.

Local verification completed on 2026-11-05 using disposable PostgreSQL 18.6,
including fresh installation, the populated 0012-to-0013 upgrade and the proposed
request grants under an actual restricted-role login. All 326 integration tests,
111 browser tests and six transport tests passed (443 total, none skipped).
`npm run lint`, `npx tsc --noEmit` and `npm run build` passed. Browser checks covered
320, 768, 1024 and 1440px, all five guest journeys, idempotent uncertainty recovery,
operations authorization, private-state clearing and the existing commerce flows.
Homepage assets, global styling and layout geometry were preserved; necessary
quotation wording/destinations changed. These results authorize no hosted action.

## Staging v3 release preparation — 2026-11-04

The current release target is the existing `la-palme-dor-staging` Cloud Run
service in project `la-palme-dor-513011`, region `europe-west1`, with canonical
origin `https://la-palme-dor-staging-4dedelrv2a-ew.a.run.app`. This preparation does
not authorize a Git commit, image push or deployment; each remains subject to
operator approval after local verification.

Earlier PostgreSQL-17-only instructions and `lapalme-staging` bootstrap naming
below are historical. The approved Neon staging database already has migrations
`0001`–`0012`, the restricted `lapalme_staging_app` role and the reviewed taxonomy
column grants. The v3 source uses those existing objects and requires no new
migration or additional grant. Do not rerun hosted migration/role artifacts.

Build the existing Dockerfile for `linux/amd64`, with public build arguments
`SITE_URL=https://la-palme-dor-staging-4dedelrv2a-ew.a.run.app` and
`SITE_INDEXING_ALLOWED=false`, tagged `la-palme-dor-staging:v3`. These arguments
control built metadata and headers; credentials remain runtime-only. Record the
verified local image/configuration ID separately from any manifest digest: an
image ID is not a registry deployment digest.

The repository LF policies preserve the exact approved migration and role-SQL
bytes across platforms. Export a reviewed source tree with
`git -c core.autocrlf=false archive`; verify all twelve migration hashes and
three reviewed SQL hashes before building. Do not normalize or rewrite the SQL
files, change their pinned hashes, or weaken checksum assertions.

After separate approval, use the verified local image and the existing registry
repository. The placeholders below must be replaced with verified release facts;
these commands have not been executed by this preparation note.

```powershell
$VerifiedLocalImageId = 'sha256:REPLACE_VERIFIED_LOCAL_IMAGE_ID'
$RegistryImage = 'europe-west1-docker.pkg.dev/la-palme-dor-513011/la-palme-dor/la-palme-dor-staging'
docker tag $VerifiedLocalImageId "${RegistryImage}:v3"
docker push "${RegistryImage}:v3"
# Read-only: resolve the uploaded tag, then verify its content/platform/digest.
gcloud.cmd artifacts docker images describe "${RegistryImage}:v3" --project=la-palme-dor-513011 --format='value(image_summary.digest)'
# Set only after uploaded-image verification; never deploy a mutable tag.
$VerifiedRegistryDigest = 'sha256:REPLACE_VERIFIED_UPLOADED_MANIFEST_DIGEST'
gcloud.cmd run services update la-palme-dor-staging --project=la-palme-dor-513011 --region=europe-west1 --image="${RegistryImage}@${VerifiedRegistryDigest}"
```

Use an image-only update. Preserve the runtime service account, public invocation
policy, Better Auth protections, pinned database/auth secret references,
`PGOPTIONS`, canonical origin, ingress, CPU, memory, scaling, concurrency, request
timeout and probes. Keep payments and checkout-retention readiness disabled.
`scripts/prepare-staging.mts` and its service template are historical bootstrap
tools with different target naming; do not use their full replacement manifest
for this existing-service image update. No local v3 result or deployment is
claimed until the release verification is recorded.

## Historical Phase 11 assessment — 2026-10-28

**PARTIAL overall. Local Node application checks pass. The proposed full application on Workers Free fails the current compatibility assessment. Staging and production are not verified.** No hosted account, plan, DNS record, migration, upload, payment or deployment was changed. Live payments remain disabled. Starting checkout: clean `master`, `3ab5bf1` (Phase 10).

## Architecture decision and measured evidence

Retain Next.js 16.4.3, React 19.2.4, Better Auth 1.7.14, pg 8.23.1 and Sharp 0.35.5. No deployment adapter or new dependency is installed in the application. The intended GoDaddy → Workers Free → Neon Free / Cloudinary Free / Paymob test architecture is **not approved for release**. No replacement hosting architecture was deployed.

Cloudflare currently recommends vinext, an API reimplementation in beta. Its 1.3.1 read-only checker reported 15 supported checks and no issues on a clean application snapshot; this is static API coverage, not runtime verification. Its peer requirements include React/react-dom 19.3.1, unlike this project. It was not initialized, and Next.js was not replaced. [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)

OpenNext 1.20.13 accepts the installed Next.js version and is the closer candidate for retaining Next.js. The isolated experiment completed the Next production build, then failed during adapter middleware generation with Windows `EPERM` creating a symlink. Earlier cross-drive dependency-junction errors were eliminated by copying dependencies before this final attempt. OpenNext itself warns about Windows and recommends WSL. No complete Worker artifact exists; deployed startup, Worker size, RSC/auth/callback integration and full workerd application tests remain **BLOCKED**. No unsupported-version override was used. [OpenNext supported versions](https://opennext.js.org/cloudflare), [setup](https://opennext.js.org/cloudflare/get-started)

Reproducible local workerd domain probes used Wrangler 4.154.0 / Miniflare 5.20261023.1-beta and compatibility date 2026-10-27:

| Actual code exercised | Result |
| --- | --- |
| Better Auth hashing + Node HMAC | Function executed; five warm hashes consumed 343.75 ms local workerd process CPU, mean 68.75 ms. |
| Existing shared PostgreSQL pool | Three consecutive requests returned 200, 503, 200. |
| Countercheck with a request-owned pool closed before return | 200, 200, 200. This is an experiment, not an application patch. |
| Existing secure image preparation | Worker initialization failed loading Sharp's native module. Validation was not bypassed. |

These are local runtime observations, not Cloudflare billed CPU or hosted TLS measurements. Request-owned database/auth lifetimes and a securely validated image-processing path need a separate complete adapter implementation/test. The application is not being rewritten around an unverified adapter. Sharp's documented WASM option requires a multithreaded runtime; installing that package alone is not evidence of Workers compatibility. [Sharp installation requirements](https://sharp.pixelplumbing.com/install/)

Cloudflare Images Free offers 5,000 unique remote-image transformations/month; it is a possible future image-processing investigation, not a replacement already integrated or verified. It would have to preserve bounded decoding, MIME/frame/pixel checks, EXIF removal, private original handling and cleanup before adoption. Cloudinary remains the storage provider. [Images pricing](https://developers.cloudflare.com/images/pricing/)

## Free-plan limits and cost feasibility

Current Workers Free limits: 100,000 requests/day; 10 ms CPU per HTTP or cron invocation; 128 MB/isolate; 50 subrequests/request; six simultaneous outgoing connections/request; 64 MiB Worker size; one-second startup; five cron triggers/account; 20,000 static files and 25 MiB per file. Cron wall time can be 15 minutes, which does not expand its CPU budget. The hashing observation exceeds that budget substantially. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

The retained public assets contain 45 files, 38,394,629 bytes total, largest 2,972,105 bytes. Those static assets fit the individual-file/count limits; this does not validate a complete Worker bundle or its CPU/memory. Local Node measurements: password verification about 103 ms process CPU each; secure five-megapixel image preparation about 109 ms process CPU each. HMAC primitives were below the Windows process-CPU measurement resolution (about 6 ms wall time for 1,000 operations), not zero cost. Native parallel image work can accumulate more CPU than elapsed wall time. Observed Node RSS after operations was about 74–79 MiB; this is neither peak memory nor a Workers measurement.

Neon Free currently publishes 1 GB/project, 100 CU-hours/project/month, five-minute idle suspension, 5 GB/project/month egress and limited recovery history. Confirm the actual account quotas/version/connection settings before setup. A one-minute unconditional database poll prevents five-minute idle suspension: **at 0.25 CU, 31 continuous days cost 186 CU-hours**, exceeding 100. Activity-aware maintenance or another explicitly approved operational/cost design is required; skipping uncertain payments or disabling safety jobs is not a solution. [Neon pricing](https://neon.com/pricing), [plan limits](https://neon.com/docs/introduction/plans), [compute sizing](https://github.com/neondatabase/website/blob/main/content/faqs/managed-postgres-services-pay-active-compute.md)

Hyperdrive is available on Free with 100,000 queries/day, not assumed necessary or unlimited. It was not provisioned. Any future use must disable query caching for transactional/customer data, preserve role separation and evaluate query counts. Direct pg connectivity was exercised locally only; actual Neon TLS, cold resume, pooling and fleet limits remain unverified. [PostgreSQL from Workers](https://developers.cloudflare.com/workers/tutorials/postgres/), [Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)

Cloudinary Free provides 25 shared monthly credits. A credit represents 1 GB storage, 1 GB image bandwidth or 1,000 transformations; usage across these resources adds together. Proxy delivery and repeated private reads must be budgeted, including the account's applicable origin metering. For illustration, 10,000 one-MiB image reads transfer roughly 10 GB before other usage. No real quota or merchant usage was observed. [Cloudinary pricing](https://cloudinary.com/pricing), [billing definitions](https://cloudinary.com/documentation/billing_and_plans)

No recurring service was purchased. Domain renewals and Paymob fees remain the accepted business costs, not amounts estimated without the actual contract. A minimal alternative is an existing trusted, reliably available Node host if one is already available; otherwise obtain approval for a modest Node-host/database budget. Workers Paid starts at $5/month but would not by itself resolve the current image and connection-lifetime defects. No alternative was implemented. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

## Database deployment and least privilege

All twelve immutable migrations, fresh application, replay, legacy adoption/checksum protections and encrypted restore were validated on disposable PostgreSQL 17. Use a provider-supported PostgreSQL 17 instance to match that baseline, and verify its actual version before execution. No Neon project was created or connected. No migration was added or altered.

Hosted migration procedure is **operator-controlled and not executed**:

1. Obtain approval for the exact Neon project, branch, database, migration-owner identity and release revision. Keep staging separate. Choose a session-preserving/direct endpoint for the advisory lock, never assume transaction pooling preserves it.
2. Take and test an encrypted backup when any data exists. Inventory schema/ledger and compare every normalized SHA-256 with the approved files. Stop on unknown schema, drift, missing history or conflicting objects; never reset/adopt it to silence an error.
3. Rehearse the exact reviewed change on an isolated local restore with the unchanged runner. Existing CLI tools remain loopback-only; do not remove their guard or point them at Neon.
4. Prepare a separately reviewed operator SQL execution artifact from the same validated migration bodies. Hold the existing session advisory lock `(1279348813,2)`, verify the exact applied prefix, execute one migration transaction at a time and stamp that file's normalized checksum before committing. For 0001–0005 preserve the original ledger; 0006 introduces and verifies legacy checksums. No new hosted executor is supplied or authorized by this phase.
5. Require `ON_ERROR_STOP`, verified TLS and an explicit target check. On failure retain the committed prefix and investigate; no automatic reset, destructive rollback or production restore. Verify the final twelve-row ledger, schema, constraints, role grants and application smoke checks before enabling access.

The reviewed operator artifact and real hosted execution are release gates. A local rehearsal does not authorize either. Initial hosted administrator provisioning also needs an approved operator procedure; public signup remains disabled.

Runtime URLs remain separate: `DATABASE_URL` public catalogue reads; `ADMIN_DATABASE_URL` auth/catalogue/order operations; `CART_DATABASE_URL` cart and disposable drafts; `PAYMENT_DATABASE_URL` verified payments/reservations. A separate `MEDIA_CLEANUP_DATABASE_URL` is used for operator jobs. Migration/restore-owner credentials must never be runtime credentials. Pools have per-instance caps/timeouts; total Node usage can reach four pools × four clients per instance, plus operators/jobs. Budget the entire fleet against the actual Neon endpoint, not one URL.

Before hosted activation, inspect `pg_roles`, `pg_auth_members`, `has_schema_privilege`, `has_table_privilege` and `has_column_privilege`, including inherited/PUBLIC privileges. Runtime roles must lack superuser, CREATEDB, CREATEROLE, inappropriate memberships, persistent DDL and cross-role sensitive access. Keep `public` non-writable by runtime/PUBLIC; no application SECURITY DEFINER functions are introduced. Fixture tests verify effective restrictions, but not hosted grants. Reuse the reviewed grant lists in `database-schema.md`.

For the new media job role, the required grants are narrowly bounded (role creation/password distribution remains operator work):

```sql
GRANT USAGE ON SCHEMA public TO media_cleanup_runtime;
GRANT SELECT ON catalogue_media_jobs TO media_cleanup_runtime;
GRANT UPDATE(state,attempts,available_at,updated_at) ON catalogue_media_jobs TO media_cleanup_runtime;
GRANT SELECT(id,cloudinary_public_id) ON product_media TO media_cleanup_runtime;
GRANT INSERT ON audit_events TO media_cleanup_runtime;
```

## Maintenance and monitoring gates

These are Node operator commands, not Worker Cron entrypoints. No cron configuration or readiness flag is enabled. Use a trusted scheduler/available machine only after approving its reliability and cost. [Cron execution model](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

| Task | Intended frequency / bound | Safety, retry and observation |
| --- | --- | --- |
| `checkout:purge` | At least hourly; up to 20 × 500 rows/run | Expired/inactive drafts only; row locking; safe repeated runs. Check exit status/deleted count and backlog. Never set retention readiness until scheduling/monitoring actually pass. |
| `payments:reconcile -- run 10` | Every minute while operational policy requires it; max 50 claims | Durable leases, authenticated inquiry outside transactions; retain uncertain holds. Inspect `list` after runs; checked does not mean resolved. Alert on failures and stale reservations; operator escalation within an hour. |
| Expired reservation review | Same payment reconciliation path | No separate competing timer. Expiry/not-found never proves non-payment. Disable initiation if reconciliation/operator coverage fails. |
| `media:cleanup -- 25` | Every five minutes; max 50 jobs | Shared UI/operator domain logic, SKIP LOCKED, five-minute leases, generation-checked completion and transactional SYSTEM audit. Retry idempotent deletion; do not delete referenced assets. Exit 0 complete, 2 backlog, 1 failure. Monitor overdue jobs, not just successful invocation. |
| Existing counters/cart expiry | Bounded request-time housekeeping | Does not replace scheduled draft/payment/media jobs. Financial/cart history remains protected. |

Keep `CHECKOUT_DRAFT_RETENTION_READY=false`, `PAYMENTS_RECONCILIATION_READY=false` and `PAYMENTS_TEST_ENABLED=false` until their actual operational prerequisites are verified. No alerts or job-health service has been configured. Manual inspection is an operator requirement, not claimed continuous monitoring. Missing scheduler execution is a production blocker.

## Encrypted backups and isolated recovery

`npm run db:backup -- backup ABSOLUTE_OUTSIDE_REPO_FILE.lpdg` uses `BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY` and `PG_BIN`. It runs read-only `pg_dump --format=custom --no-owner --no-privileges`, encrypting the stream with AES-256-GCM and a fresh nonce. No plaintext backup is written. All inherited libpq connection overrides are scrubbed; verified TLS is mandatory for non-loopback sources. Set a trusted `PGSSLROOTCERT` where the operator's libpq installation requires it. Never put credentials in argv, shell history or logs.

Generate a cryptographically random 32-byte base64url key directly into a protected operator environment; do not print it. Keep it separately from encrypted backups, with an offline recovery copy. Restrict directory ACLs, encrypt the operator disk, keep one off-device encrypted copy, and choose documented retention. No paid storage or secret manager was provisioned. A daily backup gives at best a 24-hour logical RPO; restore time/retention and gateway reconciliation after data loss require business approval. Account for backup bytes × frequency in Neon's egress budget.

Set `RESTORE_DATABASE_URL` to a **nonexistent loopback** `lapalme_test_restore_<unique_lowercase_suffix>` database, with an operator role permitted to create it. Run:

```text
npm run db:backup -- restore-local ABSOLUTE_BACKUP_FILE.lpdg --confirm-new-local-restore
```

Authentication of the complete archive precedes database creation. Every existing target is refused, including empty/routine/enum/custom-schema targets. `pg_restore` uses a single transaction, no owner/grants and no clean/reset. Private temporary plaintext is needed for bounded-memory authentication before restore; it stays outside the repository, is removed in finally, and requires restrictive OS ACLs/encrypted storage. After a crash, inspect and remove only that operation's private staging directory. A failed restore may leave its newly created disposable database for operator inspection; no automatic database deletion is attempted.

Verify all twelve ledger checksums, representative ordered jewellery/financial history, row counts, constraints and application reads. Reapply reviewed runtime grants separately, since archives omit them. Revoke restored sessions and review key rotation in an actual disaster before reopening service. This tool never restores a hosted/production database. An actual recovery there requires separate authorization and Paymob reconciliation; restoring a database cannot rewind gateway payments.

Real local pg_dump → encrypted archive → fresh local pg_restore passed, preserving the twelve-row checksum ledger and signed-mock paid-order history. Corrupt ciphertext/wrong keys, poisoned PGHOSTADDR, repository outputs, overwrites, hosted targets and existing targets were tested. Hosted backup storage, account recovery/RPO/RTO, key custody and an operational schedule remain unverified. Neon's limited published Free history window is not indefinite recovery. [Neon recovery limits](https://neon.com/docs/introduction/plans)

## Secrets, domain, media and payment verification

Use separate local/staging/production credentials and independently scoped roles; never NEXT_PUBLIC secrets. `.env.example` contains placeholders/default-off gates only. Backend secrets belong in the approved host's secret facility; preserve a separate protected operator environment for backups/migrations. No secret values were printed. The application dependency audit reported zero advisories, without upgrades or lockfile changes.

Better Auth's documented database representation stores the session identifier without hashing. Keep session/account tables, database credentials and backups sensitive; signed HttpOnly/Secure/Strict cookies, eight-hour expiry, revocation checks and server-side role reloads remain enabled. No replacement auth scheme is introduced. The independent source review and security regressions completed; the formal Codex Security launcher failed on its Python alias before assigning a scan ID, so no sealed scan is claimed.

For a GoDaddy-registered domain, preserve the DNS inventory and mail records first. If the target architecture is later approved, use Cloudflare's documented zone/custom-domain procedure and its assigned DNS/nameserver values; never guess an A record or issue changes here. A registrar transfer is not required. Wait for verified certificate issuance and test HTTPS redirects; enable HSTS only after checking the final host. Choose one canonical hostname and set `SITE_URL`, `CART_ORIGIN` and `BETTER_AUTH_URL` consistently before build and at runtime. No insecure production fallback, cross-domain session cookie or guessed callback hostname is supplied. [Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

Configure Paymob callbacks only for the confirmed origin: `/api/payments/paymob/callback` and the existing order-scoped return path. No live merchant identity/card was used. Missing authorized sandbox scenarios include genuine intention/hosted-checkout responses, actual HMAC callback delivery, retries/timeouts/inquiry, duplicate/out-of-order/lost callbacks, failed payment, late success and expired holds against real provider behavior. Browser return claims remain non-authoritative. [Paymob API flow](https://developers.paymob.com/paymob-docs/integration-paths/apis)

Cloudinary mock coverage preserves server-mediated authenticated uploads, complete decode/MIME/frame/pixel/byte validation, orientation/EXIF removal, signed response metadata, publication-gated delivery and cleanup retries. No real upload/deletion, Free-account delivery entitlement or quota was verified. Provider access and isolated authorized credentials are required before testing them.

## SEO, accessibility and performance

Added global nosniff/frame-denial/no-referrer/permissions headers, with `X-Robots-Tag: noindex, nofollow` by default. `SITE_INDEXING_ALLOWED=true` requires a valid configured HTTPS origin and must be set **before build and at runtime**, only for an approved production release; staging stays disabled. The flag controls indexing, not deployment/payment readiness.

Robots excludes private/admin/API/cart/checkout/order paths; unconfigured/staging robots disallows all. Sitemap is request-time, makes no build-time database connection, reuses publication/ancestor rules, excludes development/private records, and refuses silent 50,000-URL truncation. A configured catalogue outage fails rather than advertising an empty catalogue. Canonicals use configured origins, never forwarding headers. The public browser fixture now uses a reserved `.test` domain instead of a deliberately invalid origin, retaining its positive canonical assertion.

Existing desktop/tablet/mobile navigation, keyboard controls, long names, unavailable/empty catalogue behavior and image/error checks passed. Headless/local measurements are not field Core Web Vitals or a hosted performance SLA. Existing homepage metadata includes an IGI-certification claim; evidence was not verified and the approved copy was preserved. Owner confirmation or an approved metadata correction remains a release content gate. No ratings/reviews/certificates were invented. CSP nonce policy, final-host HSTS, real-domain canonicals and search-console validation remain operator/deployment checks.

Final synthetic homepage observations, with reduced motion and local Chromium: desktop LCP 2,632 ms / CLS 0.000778; mobile LCP 212 ms / CLS 0. These are single local samples, without field INP or a production performance conclusion. Both full-page before/after captures were pixel-identical. Desktop viewport was identical; mobile viewport differed in 2.02% of pixels by at most 7/255 per channel, within the existing 2.5% / 8-channel tolerance. No tolerance was relaxed.

## File inventory and final local verification

Created (13):

```text
db/tools/backup.ts
docs/production-readiness.md
scripts/backup-database.mts
scripts/cleanup-media.mts
scripts/measure-readiness.mts
scripts/probe-workers.mts
src/app/robots.ts
src/app/sitemap.ts
src/lib/catalogue/sitemap.ts
src/lib/media/cleanup.ts
src/lib/site.ts
tests/readiness.browser.mts
tests/readiness.test.mts
```

Modified (9):

```text
.env.example
docs/database-schema.md
next.config.ts
package.json
src/app/layout.tsx
src/lib/admin/catalogue/media.ts
src/lib/catalogue/repository.ts
src/lib/catalogue/storefront.ts
tests/storefront.browser.mts
```

The 223-file starting SHA-256 inventory has no missing files: 214 unchanged, the nine modifications above, and thirteen additions. All public imagery, the homepage page/CSS/components, twelve migrations, payment core and dependency lockfile remain unchanged. Root-layout changes are only the canonical helper import and metadata field; its fonts and rendered markup remain unchanged. Dependencies were neither added nor upgraded. The existing ignored shortcut and original TypeScript build-info file are preserved.

The final focused readiness rerun passed 16/16, including the restricted media-job identity; the final production-mode application build, TypeScript check, lint and whitespace check passed. Across the final suites, 225 integration and 43 browser tests pass (268 total: 250 prior regressions and 18 new checks). The expected failing workerd compatibility probe is reported separately and does not become an application-test PASS.

Cleanup completed: no fixture databases or roles remained before shutting down the phase-owned PostgreSQL cluster. Its exact temporary root and marker were removed, including adapter tools/snapshots, internal build junctions, browser captures, logs, scratch scripts, certificates and encrypted/plain restore fixtures. Internal junctions were unlinked without traversing their targets. No test listeners remain. The existing `postgresql-x64-17` service is still running; the original TypeScript build-info bytes were restored. User-owned files, normal npm cache, migrations and client imagery were preserved. Final Git state: `master` at `3ab5bf1`, nine modified files and thirteen untracked additions, nothing staged; no commit, push or deployment.

## Reproduction and release matrix

Run all existing test scripts, plus `test:readiness` and `test:readiness:browser`, on disposable loopback PostgreSQL with the documented existing Playwright/Chromium/TLS harness. Run browser suites sharing ports sequentially. `npm run readiness:measure` prints separate Node CPU/wall/RSS observations using synthetic data.

For optional workerd probes, install `@opennextjs/cloudflare@1.20.13`, `wrangler@4.154.0`, `next@16.4.3`, `react@19.2.4` and `react-dom@19.2.4` in a private temporary tools directory (not this application). Set `CLOUDFLARE_PROBE_MODULES` to its node_modules and an explicit disposable loopback `TEST_DATABASE_URL`, then run `npm run readiness:workers`. It cleans its scratch directory and deliberately exits nonzero for the observed incompatibilities. It cannot deploy or use a remote database. Adapter checks were conducted in disposable Git snapshots, never with vinext init or deploy commands.

| Release requirement | Status | Evidence / remaining boundary |
| --- | --- | --- |
| 1. Local application tests | PASS | 225 integration + 43 browser checks; lint, tsc and empty-configuration build. |
| 2. Cloudflare build compatibility | BLOCKED | OpenNext Windows symlink failure; no complete Worker. vinext static check is not a runtime build. |
| 3. Workers Free runtime limits | FAIL | Shared-pool/image failures and local hashing CPU risk; no hosted quota enforcement measurement. |
| 4. Hosted Neon connectivity | NOT VERIFIED | No authorized hosted connection; local pg/workerd probes only. |
| 5. Hosted migration integrity | NOT VERIFIED | Local twelve-file chain/restore passes; no approved remote execution artifact or hosted run. |
| 6. Database grants | PASS | Effective fixture grants/role/DDL/membership checks; actual hosted grants pending. |
| 7. Cloudinary live operations | NOT VERIFIED | Mock upload/delivery/cleanup only. |
| 8. Paymob sandbox payment | NOT VERIFIED | No genuine sandbox merchant transaction. |
| 9. Paymob callback delivery | NOT VERIFIED | Signed synthetic callbacks only. |
| 10. Inventory concurrency | PASS | Local transactional/race/idempotency regressions; provider staging still pending. |
| 11. Payment reconciliation | NOT VERIFIED | Mock lifecycle passes; hosted scheduling/inquiry/alert coverage pending. |
| 12. Checkout draft purge | NOT VERIFIED | Local bounded/idempotent purge passes; real schedule/monitoring absent. |
| 13. Media cleanup | NOT VERIFIED | Local concurrent operator/UI domain tests pass; real provider/schedule absent. |
| 14. Database backups | NOT VERIFIED | Encrypted local backup passes; actual Neon backup/key custody/storage/schedule pending. |
| 15. Restore test | PASS | Authenticated archive restored into newly created local PostgreSQL; no production restore. |
| 16. Authentication | PASS | Local HTTPS session/role/revocation tests; hosted runtime pending. |
| 17. Customer privacy | PASS | Ownership/grants/no-store/secret-isolation regressions; deployed edge behavior pending. |
| 18. Domain and HTTPS | NOT VERIFIED | Local test TLS only; no live DNS/certificate/callback configuration. |
| 19. SEO | NOT VERIFIED | Local controls pass; final domain/indexing/content-claim approval remains. |
| 20. Homepage preservation | PASS | Starting/final desktop and mobile browser comparison and protected source/assets checked. |
| 21. Free-tier cost feasibility | FAIL | Full current Workers target not compatible; unconditional minute polling also exceeds the illustrated Neon compute budget. |

**Local application validation passes; LOCAL READINESS PASS for the full target architecture is not granted. STAGING PASS and PRODUCTION READY are not granted.** Resolve hosting/runtime and maintenance/cost decisions, obtain explicit staging/provider authorization, validate recovery/monitoring and final domain/content before reconsidering release. No commit, push, deployment or live payment activation is part of this phase.

## Phase 11B: native Node.js hosting feasibility — 2026-10-28

**PARTIAL overall; native Linux/container compatibility PASS. Neither provider is production-ready without hosted validation.** This section supplements the Phase 11 record above. No cloud account, project, billing, DNS, hosted database, provider asset, payment or deployment was created or changed. All operational flags remain unchanged/default-off. The Workers experiment was not continued.

### Starting state and preservation

Started on `master`, `3ab5bf1d00f0aebdfac147dbb8c36e560cf2b782`, with nine modified and thirteen untracked Phase 11 files, nothing staged:

```text
 M .env.example
 M docs/database-schema.md
 M next.config.ts
 M package.json
 M src/app/layout.tsx
 M src/lib/admin/catalogue/media.ts
 M src/lib/catalogue/repository.ts
 M src/lib/catalogue/storefront.ts
 M tests/storefront.browser.mts
?? db/tools/backup.ts
?? docs/production-readiness.md
?? scripts/backup-database.mts
?? scripts/cleanup-media.mts
?? scripts/measure-readiness.mts
?? scripts/probe-workers.mts
?? src/app/robots.ts
?? src/app/sitemap.ts
?? src/lib/catalogue/sitemap.ts
?? src/lib/media/cleanup.ts
?? src/lib/site.ts
?? tests/readiness.browser.mts
?? tests/readiness.test.mts
```

Read root `AGENTS.md`/`CLAUDE.md`, architecture/schema/readiness documents, and the installed Next.js 16.4.3 output, self-hosting and environment guides. A starting SHA-256 inventory covered 235 nonignored files. Existing Phase 11 changes were confirmed and preserved; no dependency, lockfile, migration, business schema, homepage, component or security-policy implementation was changed by 11B.

### Native production configuration and container

The existing `npm run build` → `npm start` workflow remains supported. `NEXT_STANDALONE=true` opts into Next's supported `output: "standalone"`; the Docker builder sets it explicitly. Keeping the ordinary output by default avoids requiring Windows standalone symlink privileges. Standalone builds run `node server.js`, with both `public` and `.next/static` copied into the artifact. No custom server, framework replacement or adapter is needed. [Next.js output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

`Dockerfile` uses a digest-pinned official Node 22 Debian Bookworm slim base, dependency/build/runtime stages, and `npm ci --include=optional`. Production runs as the existing `node` user (UID 1000), directly executing Node as PID 1. The allowlist `.dockerignore` admits only package manifests, required build configuration, `src` and `public`, additionally excluding environment/key files. Git history, local `node_modules`, Windows binaries, `.next`, tests, database fixtures, operator scripts and development secrets do not enter the production context. No secret build arguments exist. Native optional binaries are installed on the target architecture, never copied from Windows.

Verified base manifest: `node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da`. Actual container Node: **22.23.4**; local Windows Node: **22.17.1**. Node 22 remains supported through April 2027; review/retest a supported base and refresh its digest before then, including security updates. Pinning is reproducible, not an automatic patch service. [Node release schedule](https://github.com/nodejs/Release).

Local commands, requiring no cloud credentials:

```sh
docker build --platform linux/amd64 -t la-palme-local .
docker run --rm -p 127.0.0.1:8080:8080 --memory 1g --cpus 1 \
  --cap-drop ALL --security-opt no-new-privileges la-palme-local
```

For a later approved hostname, pass public `SITE_URL` and `SITE_INDEXING_ALLOWED` build arguments and consistent runtime values. They affect prerendered metadata, robots and serialized response headers; changing runtime values alone cannot change already built static output. Keep indexing false on demos/staging. Application database/auth/media/Paymob secrets are injected only at runtime through the approved host's protected environment. No `NEXT_PUBLIC_` secrets, secret `.env` files in images, or automatic migrations/provisioning at startup.

| Capability | Evidence from this phase |
| --- | --- |
| Next startup, RSC, route handlers, Proxy | Linux AMD64 standalone build and production-image browser suites pass, including catalogue navigation and protected administration. |
| Sharp 0.35.5 | Native Linux PNG preparation and real `/_next/image` request pass. Authenticated upload/decode/EXIF/metadata/privacy flows pass against a synthetic Cloudinary provider. |
| Better Auth | Password hashing, login, secure sessions, role reload/revocation, origin checks and distributed limits pass in Linux integration and production-image HTTPS browser checks. |
| PostgreSQL | All twelve migrations, least-privilege roles, transactions, locks, rollback, stock/payment concurrency and recovery checks pass on disposable Linux PostgreSQL 17. |
| Guest cookies and checkout | Real HTTPS browser assertions pass for Secure/HttpOnly ownership, persistent cart, draft access and cross-session denial. No cookie security setting was weakened. |
| Paymob | Existing HMAC/tampering, idempotency, uncertain/late outcomes and compiled callback routes pass with signed synthetic callbacks; no genuine merchant transaction was attempted. |
| Empty runtime configuration | `/`, `/collections`, `/api/cart`, robots and sitemap serve; `/admin` redirects to login; protected catalogue API returns safe 503 when auth is unconfigured. No database is required to start the public demo. |
| Architecture | AMD64 full build/runtime verified. ARM64 lockfile installation, native Sharp and Better Auth hash/verify pass under local emulation; a complete ARM app build, Oracle hardware and hosted execution remain unverified. |

Sharp publishes Linux x64 and ARM64 glibc prebuilds; Bookworm satisfies its documented requirements. A future Oracle A1 build must target `linux/arm64` throughout. An AMD64 image is the Cloud Run target. Never upload a Windows-built native dependency tree. [Sharp installation](https://sharp.pixelplumbing.com/install/).

The image is **135,076,132 bytes (about 128.8 MiB)** by local Docker inspection, not a registry-compressed size. It ran with 1 vCPU/1 GiB; observed idle memory after smoke requests was approximately **95.7 MiB**, not peak RSS or a sizing SLA. `PORT=8080` and overridden `PORT=9090` both served HTTP 200. The database-free `/robots.txt` Docker healthcheck became healthy. It establishes process liveness, not database/payment readiness. Configure Cloud Run startup/liveness probes separately; do not use an external periodic health request to keep the app or Neon awake.

The exec-form entry point lets Next handle SIGTERM. A local stop completed in **381 ms**, exit **143**, without OOM/SIGKILL. This verifies idle termination, not every interrupted payment/upload. Cloud Run's ten-second shutdown grace is shorter than some provider operation timeouts; durable dispatch/cleanup leases and reconciliation remain essential. No payment work is delegated to an unreliable post-response timer. [Cloud Run runtime contract](https://docs.cloud.google.com/run/docs/container-contract).

Only disposable caches (including approved public image optimization) may live on the service filesystem. Customer records/sessions/leases remain in PostgreSQL; uploaded assets remain in Cloudinary. Authenticated media responses remain private/no-store and bypass the public image optimizer. The image contains no operator/test sources. Existing maintenance commands therefore require a separately prepared operator checkout or job artifact; overriding this web image's command to a nonexistent script will not work.

### Google Cloud Run assessment

**Technically suitable; conditional on accepting metered billing and hosted validation.** Proposed staging settings: request-based billing, service minimum **0**, no revision-level warm minimum, **1 vCPU / 1 GiB**, concurrency **4**, initially maximum **2** instances, and an explicitly bounded request timeout (e.g. 60 seconds). These are conservative starting settings, not measured production capacity. Load-test simultaneous images, scrypt, catalogue traffic and callbacks before raising limits. Platform maximum concurrency is 1,000; the ordinary default is 80 for a one-vCPU service. [Billing mode](https://docs.cloud.google.com/run/docs/configuring/billing-settings), [minimum instances](https://docs.cloud.google.com/run/docs/configuring/min-instances), [concurrency](https://docs.cloud.google.com/run/docs/about-concurrency).

Scale-to-zero adds application startup and possibly Neon-resume latency. A local ready message is not a hosted cold-start measurement. Image size, font/native module loading, region distance and first image optimization matter. Use a region near the actual Neon project and measure Egyptian-client and callback latency. Saturation, scaling delay or quota exhaustion can reject requests; a small maximum instance count protects the database but limits throughput. [Autoscaling behavior](https://docs.cloud.google.com/run/docs/about-instance-autoscaling).

Cloud Run provides an HTTPS `run.app` endpoint. Public visitors and Paymob must be able to reach the existing callback without Google identity or an interactive challenge; application HMAC authentication stays mandatory. Persist the receipt/state transaction before acknowledging it. Do not assume a provider retry schedule: validate actual callbacks, duplicates, cold starts, timeouts and lost responses with an authorized sandbox merchant. Monitor pending/uncertain attempts and preserve holds during failure. Real callback delivery remains unverified.

Custom domains have an additional constraint: Google's direct domain mappings are currently Preview and explicitly not recommended for production. A documented production alternative is an external application load balancer, adding costs and configuration. The assigned `run.app` hostname can support an initial authorized staging test without that extra infrastructure. Do not promise a free production custom-domain route or invent registrar/DNS values. [Custom domain options](https://docs.cloud.google.com/run/docs/mapping-custom-domains).

Cloud Scheduler can invoke Cloud Run Jobs with IAM authentication, not a public maintenance endpoint. Request-based service CPU is unsuitable for internal cron. Jobs need the existing source/dependencies, least-privilege task credentials, bounded retries/timeouts and, for backups, PostgreSQL 17 client tools plus durable encrypted output storage. These artifacts/schedules are assessed, not implemented or enabled. Set job task parallelism to one where appropriate and retain existing database leases for retries/overlap. Job launch success is not proof that the task or backlog completed. [Scheduled Cloud Run Jobs](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule).

Published reference prices, USD, Tier 1, before tax and other services: request-based service allowances are **180,000 vCPU-s, 360,000 GiB-s and 2 million requests/month**, account-shared. Excess active CPU is **$0.000024/vCPU-s**, memory **$0.0000025/GiB-s**, requests **$0.40/million**. No fixed hosting subscription is required; usage can still be charged. Jobs have a **60-second minimum per started instance**, at instance rates. One 1-vCPU/512-MiB job every minute over 31 days bills at least 2,678,400 vCPU-s and 1,339,200 GiB-s: approximately **$45.67** after otherwise-unused 240,000/450,000 job allowances, excluding other costs. This is a calculated scenario, not a quote. Internet egress is additional; the published 1-GiB North American allowance does not make delivery to Egypt free. [Cloud Run pricing](https://cloud.google.com/run/pricing).

Other costs must be budgeted independently:

| Item | Published allowance / cost implication |
| --- | --- |
| Cloud Scheduler | Three jobs/month free per billing account; additional jobs $0.10 each per 31 days. Four separate schedules normally exceed that allowance by one. Execution compute is separate. [Scheduler pricing](https://cloud.google.com/scheduler/pricing). |
| Cloud Build | 2,500 promotional free minutes for default-pool e2-standard-2; then reference $0.006/minute. Local builds avoid this hosted-build line, not registry/storage/transfer costs. [Build pricing](https://cloud.google.com/build/pricing). |
| Artifact Registry | First 0.5 GiB-month shared per account free; beyond that about $0.10/GiB-month at the published hourly rate. Retained revisions, job images, scanning and transfer can add charges. Local unpacked image size is not a storage-bill estimate. [Registry pricing](https://cloud.google.com/artifact-registry/pricing). |
| Other services | HTTPS load balancer, backup object storage, secret versions/access, logs, alerts and cross-region/internet traffic have separate pricing. None was provisioned. |

Cloud Run requires enabled billing for deployment; none was enabled here. Set narrow IAM, service/job instance limits, regional quotas, registry/log retention and cost alerts before any future authorization. Ordinary alerts-only budgets do not stop charges. Current Google documentation also lists **Cloud Run service-scoped spend-cap budgets**: evaluate eligibility and estimate/enforcement limitations, and understand that enforcement pauses service/callback availability. Such a cap does not cover unrelated registry/build/storage services or prove a zero total bill. No budget or spend cap was configured. [Deployment prerequisites](https://docs.cloud.google.com/run/docs/quickstarts/deploy-container), [alerts-only budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets), [spend caps](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps).

### Oracle Always Free assessment

**Technically suitable when capacity exists; substantial operator responsibility and availability risk.** Current official documentation lists two E2.1.Micro AMD instances (each 1 GB, 1/8 OCPU), or A1 Flex ARM allowances of **1,500 OCPU-hours / 9,000 GB-hours monthly**, equivalent to **2 OCPUs / 12 GB total**, in the home region. Do not use older 4-OCPU/24-GB estimates. It also lists **200 GB** combined boot/block storage, **five** volume backups and **10 TB/month** outbound transfer. Confirm account eligibility and actual allowances before selecting a shape. Idle resources may be reclaimed after seven days of low CPU/network use (and low memory for A1); free capacity can be unavailable. [Always Free limits and reclamation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

A1 is the more plausible host: start evaluation with one OCPU and 2–4 GB memory, then measure real memory/load and select a size within the tenancy allowance. This is an engineering proposal, not an available-capacity claim. E2 Micro leaves little room for Next builds, scrypt, Sharp, proxy and OS; it is not the preferred production candidate. Build outside a constrained VM on the matching Linux architecture. Do not combine RAM from separate Micro VMs as if it were one host. Reclamation must be accepted as an outage/recovery risk, never defeated with artificial load or polling.

Use a supported Always Free-eligible Linux image, one non-root Next process/container, and Nginx or equivalent terminating HTTPS. Bind Node only to loopback/internal container networking. Restrict public ingress to 80/443; restrict key-only SSH to operator addresses or a reviewed access channel. Do not expose PostgreSQL, Docker's control socket or the Node port publicly. Overwrite trusted proxy headers; enable `ADMIN_TRUSTED_IP_HEADER=x-real-ip` only after proving origin isolation. Preserve request/body bounds, cookie flags, streaming and no-store behavior; disable proxy response buffering for streamed Next responses and avoid temporary request-body files for customer uploads where practical. [Nginx proxy behavior](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

Use systemd process supervision (or a reviewed Docker restart policy), network-online ordering, bounded restart backoff and a 30-second VM shutdown allowance. Verify boot recovery, crash recovery, TLS renewal, failed renewal alerts and restoration onto a replacement VM. Configure automatic security updates with a planned reboot/recovery window; Node/container base updates need their own rebuild/retest process. [Oracle automatic updates](https://docs.oracle.com/en/operating-systems/oracle-linux/software-management/sfw-mgmt-UpdateSoftwareAutomatically.html), [Ubuntu automatic updates](https://ubuntu.com/server/docs/how-to/software/automatic-updates/).

Systemd timers/cron can run the existing commands without a per-launch Cloud Run Job minimum. Use a dedicated operator checkout outside the served artifact, separate protected environment files per task, task locking, time limits, last-success tracking and failure alerts. A persistent timer can catch a missed daily/hourly run after boot; do not replay every missed minute or treat a late job as continuous coverage. A stopped/reclaimed VM also loses its scheduler. External VM/job-failure alerts and off-VM backups remain necessary. No Oracle account, VM, proxy, certificate, firewall or timer was configured.

### Neon, maintenance and recovery

Retain **Neon PostgreSQL initially**, with separate catalogue, admin, guest-cart, payment and operator credentials. Published Free allowances currently include 100 CU-hours/project/month, 1 GB/project, 5 GB/project/month transfer and five-minute idle suspension; actual account/version/limits must be checked before connection. Free compute/transfer exhaustion can suspend the database; free recovery history is limited. No hosted connection was made. [Neon pricing](https://neon.com/pricing), [plan behavior](https://neon.com/docs/introduction/plans).

Each application instance can create four lazy pools of four connections: **16 clients**, hence **32** for two fully used instances, with additional rolling-revision overlap, jobs/operators and restore activity. Idle timeout is 10 seconds, lifetime 60 seconds, acquisition timeout 5 seconds, SQL timeout 8 seconds. An always-running Node process alone need not keep Neon computing: these pools do not issue periodic health SQL. Cloud Run idle CPU throttling can delay pool timers; hosted reconnection after idle must be tested. Do not automatically retry payment mutations after ambiguous errors.

Use direct/session-preserving Neon endpoints initially with a small verified connection budget. A transaction-pooled endpoint may later reduce backend pressure, but is **not yet approved for this exact configuration**: pg sends `statement_timeout` and `idle_in_transaction_session_timeout` startup parameters, and Neon documents unsupported-startup-parameter failures on pooled endpoints. Verify that timeouts remain enforced rather than removing security limits to get a connection. The transaction/advisory-lock payment design fits transaction scoping in principle; migration session advisory locks and backup tools require direct connections. Local direct PostgreSQL tests do not validate Neon TLS, pooling or resume behavior. [Neon pooling](https://neon.com/docs/connect/connection-pooling), [startup-parameter errors](https://neon.com/docs/connect/connection-errors).

There is **no existing activity-aware scheduler**. A scheduler that first queries Neon every minute still prevents sleep. Existing browser code also matters: visible cart/checkout refreshes every 30 seconds, and visible order status every five seconds, including after terminal outcomes; a valid customer session can therefore keep Neon active on either host. These behaviors were inspected and preserved, not silently optimized. A future bounded/backoff status-refresh policy needs separate functional review; public no-cookie bag reads take the existing cheap path. At 0.25 CU, continuous activity over 31 days is **186 CU-hours**, exceeding 100. Even occasional hourly jobs can add roughly five active minutes per run; brief invocation time alone understates the database cost.

| Existing task | Feasible execution / unresolved gate |
| --- | --- |
| `checkout:purge` | At least hourly; existing 20 × 500-row bound, expiry checks and idempotency retained. Alert on failure and oldest draft/backlog. Retention acknowledgement stays false. |
| `payments:reconcile -- run 10` | Existing requirement is at least every minute when payments operate. Durable claims and authenticated inquiries preserve uncertain holds. Current zero-subscription/Neon-free assumptions do not establish an affordable reliable continuous schedule. Initiation stays disabled; do not weaken frequency or silently free reservations. |
| Reservation reconciliation | Use the same payment lifecycle. Monitor stale holds, unmatched authenticated events and stock-ledger exceptions; no competing expiry-release cron. Escalate unresolved financial cases within the existing one-hour policy. |
| `media:cleanup -- 25` | Existing five-minute target, leases, generation checks and reference checks retained. A code-2 backlog is actionable, not ordinary success; monitor oldest pending work and provider failures. |
| `db:backup -- backup /protected/path/archive.lpdg` | Daily example only, with PostgreSQL 17 tools and a dedicated read-only role. AES-256-GCM output, separate key custody, restricted storage, retention and an off-device encrypted copy are required. Never rely on ephemeral job disk as the backup destination. |
| Restore and alerts | Existing authenticated archive → fresh loopback restore passes on both OS platforms. Exercise actual hosted backup retrieval/key recovery separately. Check exit status, last successful completion and backlog; absence of a scheduler execution needs an alert too. No monitoring service was configured. |

With the current payment cadence, both application choices can leave Neon active all month. An event/activity-aware design would need a durable trigger outside a sleeping database, guaranteed continuation for outstanding attempts, recovery from a lost trigger and tested deadlines. That machinery is not supplied by this phase. Otherwise approve the necessary database/maintenance budget in a later phase; a free application host does not solve it. Do not enable any production maintenance flag to bypass the gate.

Keep backup encryption keys off the web host/image and separate from archives, with an offline recovery copy. Choose approved RPO/RTO and retention; daily logical backup gives at best 24-hour RPO. Include dump transfer in Neon's egress budget. VM-volume backups can assist OS recovery but do not back up the remote Neon database. A database restore cannot reverse gateway payments: reconcile financial truth, review sessions/keys and reapply verified grants before reopening. No hosted restore, off-device store, production backup schedule or alert delivery was verified.

### Reliability and cost decision

| Criterion | Cloud Run, request-based / min 0 | Oracle Always Free A1 |
| --- | --- | --- |
| Monthly hosting subscription | No fixed subscription; billing account required and use is metered | Eligible allocation can have $0 infrastructure charge; capacity/tenancy conditions apply |
| Variable charges | CPU/RAM/requests, egress, jobs, builds, registry, domain routing, logs/secrets/backups | Usage beyond free allocations or paid resources on an upgraded account; backup/operations choices still matter |
| Idle experience | App and database cold starts possible | App stays running while VM exists; Neon can still sleep |
| Platform maintenance | Google manages host OS; owner maintains app/base image, secrets and operations | Owner maintains OS, SSH/firewall, TLS/proxy, process, disk, patches and recovery |
| Availability | Managed service with scaling/quota/cold-start limits; no hosted SLA validation here | Single-VM failure, capacity shortage and reclamation; replacement may be unavailable |
| Scheduling | IAM-triggered Jobs possible; separate packaging and per-launch billing | Local timers practical at no separate launch charge; stop when VM stops |
| Database and backup | Existing Neon retained; secure off-service backup/storage required | Same Neon constraints; VM disk/volume backup is not a remote DB backup |
| Deployment complexity | Container + runtime config + IAM + jobs; production custom domain can add a load balancer | Matching-architecture artifact + VM hardening + proxy/TLS + systemd/timers + restore procedure |
| Current implementation fit | Full AMD64 image checked locally | Native Node fit; ARM primitives checked under emulation only |
| Strict no-charge payment production | Not demonstrated | Not demonstrated; Neon/operations and availability blockers remain |

Shared Cloudinary Free quotas, Neon restrictions, domain renewal and actual Paymob merchant fees still apply to both alternatives; this phase neither re-estimates an unknown contract nor adds a paid subscription. Public Cloudinary bytes currently traverse the application, so application egress as well as Cloudinary usage matters. No traffic forecast was supplied, and no honest all-in monthly bill can be inferred from one local memory sample.

**Recommended architecture:** retain one native Next.js Node service/container → existing Neon PostgreSQL, with Cloudinary media and the existing Paymob lifecycle (initiation disabled). Prefer Cloud Run for a later explicitly authorized public-demo/staging evaluation if metered billing is accepted; start min 0 and bounded instance/concurrency settings. Oracle A1 is a possible zero-subscription demo/low-traffic alternative only with available capacity and an accountable VM operator. Neither is approved for payment production under the current strict-free assumptions. Resolve maintenance/database cost and availability coverage first; no additional backend, Kubernetes or service split is justified.

### Verification, visual baseline and final file inventory

All existing suites were run sequentially where they share browser ports. Browser plugin not available; existing cached Playwright 1.55.0 and Chromium were used without installing application dependencies. Flow checked: load the public app → navigate catalogue/use cart and checkout → authenticate administration → exercise existing upload, payment and order workflows with synthetic providers → verify rendered state and access denial.

| Check | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npx tsc --noEmit` | PASS |
| `npm run build` (no integration secrets) | PASS |
| Existing Windows integration suites | 225/225 PASS |
| Existing Windows browser suites | 43/43 PASS |
| Linux AMD64 lockfile installation / standalone production build | PASS |
| Existing Linux integration suites | 225/225 PASS, including real pg_dump/encrypted restore |
| Existing browser suites against the production Linux image | 43/43 PASS; temporary transport adapter launches Docker instead of `next start`, preserving test assertions and HTTPS proxy. Provider mocks are read-only test mounts, absent from the production image. |
| ARM64 dependency installation / Sharp / Better Auth | PASS under emulation; full ARM server/Oracle runtime NOT VERIFIED |
| Configurable PORT / non-root / native image optimization / health / idle SIGTERM | PASS |
| Hosted cloud, Neon TLS/resume/pooling, genuine providers, deployed cold starts/load | NOT VERIFIED |

There are 268 distinct existing test cases per platform run, not 536 new tests. No permanent test code or dependency was needed. Local customer/order/payment fixtures were synthetic and restricted to phase-owned loopback databases; real merchant calls were mocked.

| Browser/visual check | Result |
| --- | --- |
| Page identity, meaningful content, no framework overlay | PASS in existing public and protected browser flows |
| Relevant console/request health and images | PASS in existing suite assertions; expected denial/error-state requests remain intentional |
| Desktop/mobile screenshots | Visually inspected at 1440×1000 and 390×844 |
| Mobile menu interaction | Open → expanded true; Escape → closed; assertions pass on Windows and container |
| Starting → final Windows homepage viewport pixels | Desktop and mobile identical |
| Starting → container homepage viewport pixels | Desktop identical; mobile 0.2072% of pixels differ by at most 2/255, inside the unchanged 2.5% / 8-channel tolerance |
| Approved source/assets/migrations | Starting hashes preserved; no design change. This is viewport comparison plus source preservation, not a claimed new full-page historical comparison. |

Phase 11B creates only **`Dockerfile` and `.dockerignore`**, and modifies only **`next.config.ts` and this existing `docs/production-readiness.md`** relative to its starting state. Final SHA-256 comparison confirms **233 of 235 starting files byte-unchanged**, those two intentional modifications, and no missing files. No new planning/progress document, source rewrite, database migration or dependency upgrade is introduced.

Cleanup completed: removed the phase's temporary QA/provider-mock/transport scripts, application test images, labelled containers, databases, logs, screenshots, certificates and exact marked scratch directory after inspection. Removed five captured build-history records and 48 phase cache records (Docker reported 4.104 GB). Fixture database/role queries returned no leftovers; test listeners are closed. Restored the original ignored TypeScript build-info bytes and Docker Desktop's initial stopped state after confirming no running containers. Existing user files, the running `postgresql-x64-17` service and unrelated Docker resources are preserved; no destructive Git cleanup, commit, push or history change was used. Ordinary ignored Next build outputs are retained. Automatic approval review rejected deletion of shared `node:22-bookworm-slim` / `postgres:17-bookworm` tags because their prior ownership was not proven, and required exact IDs instead of date/name matching for build-history deletion. Shared base-image tags are retained; cleanup used phase-scoped artifacts and captured IDs only.

Final Git state is the starting nine modified files and thirteen untracked files, plus the two new Docker files: **nine modified / fifteen untracked**, nothing staged, same branch/HEAD. The readiness document was already untracked at entry. The earlier Phase 11 assessment remains present above.

Remaining blockers: authorized hosted runtime/TLS/domain validation; actual Neon grants/version/connection and resume tests; real Cloudinary and Paymob sandbox/callback tests; monitored purge/reconciliation/media/backup schedules; secure off-device recovery/key custody; traffic/concurrency/peak-memory/cold-start measurements; approved costs and operational ownership; ARM full application/Oracle capacity/reclamation acceptance if selected. Existing Phase 11 content/security release gates remain applicable. **Stop at Phase 11B: PARTIAL; no deployment, production activation or real payment enablement.**

## Phase 11C: restricted Cloud Run staging preparation — 2026-10-28

This is an **offline preparation runbook**, not authorization to execute its cloud commands. Cloud Run is the selected host; retain Neon, Cloudinary, Paymob, GoDaddy and the existing Private Delivery/Boutique Collection implementation. No application design, security boundary, business schema or migration is changed. No Google/Neon project, billing association, API, IAM binding, secret, repository, schedule, DNS record, provider asset or payment was created. `gcloud` is not installed in this workspace; no Google account was accessed. Hosted checks are pending.

### Prepared configuration and local-only artifact generation

`infra/cloud-run/staging.template.json` is JSON-compatible YAML using Cloud Run's v1 Service schema. It specifies **1 vCPU, 1 GiB, min 0 / max 2 at service level, concurrency 4, request-based CPU allocation, port 8080, timeout 60 seconds, IAM invoker checking enabled**, a dedicated runtime service account and database-free startup/liveness probes. It leaves indexing, draft-retention acknowledgement and payment initiation/reconciliation readiness false. These are initial staging bounds, not proven production capacity. [Cloud Run schema](https://docs.cloud.google.com/run/docs/reference/yaml/v1), [service maximum](https://docs.cloud.google.com/run/docs/configuring/max-instances), [health probes](https://docs.cloud.google.com/run/docs/configuring/healthchecks).

The offline `staging:prepare` command has **no cloud, database or subprocess API**. It writes only a new file at an absolute path outside the repository, refuses overwrite, validates inputs and never deploys. The committed example contains identifiers/placeholders only. Prepare operator-owned inputs by copying `infra/cloud-run/staging.inputs.example.json` outside the repository. Replace project ID, numeric project number, region, service-account and image identifiers after they are actually approved and known; do not put secret values in this JSON. The manifest namespace uses the numeric project number from `gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)'`.

```sh
# LOCAL ONLY. Output directories must already exist; files must not exist.
npm run staging:prepare -- service /absolute/private/staging-inputs.json /absolute/private/staging.service.json
npm run staging:prepare -- migrations /absolute/private/staging-migrations.review.sql
```

Bootstrap inputs deliberately have `origin: ""` and `secrets: {}`: the restricted public demo can start with no integrations. Configured inputs use the exact HTTPS `run.app` origin returned by Google and these four secret references (names are identifiers, not secret values):

```json
{
  "DATABASE_URL": { "name": "lapalme-staging-catalogue-db", "version": "1" },
  "ADMIN_DATABASE_URL": { "name": "lapalme-staging-admin-db", "version": "1" },
  "CART_DATABASE_URL": { "name": "lapalme-staging-cart-db", "version": "1" },
  "BETTER_AUTH_SECRET": { "name": "lapalme-staging-auth", "version": "1" }
}
```

Place that object under `secrets`, not at the input root. Versions must be explicit positive integers, not `latest`; use the real approved version numbers. Optional media preparation additionally accepts `cloudinaryCloudName`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` references together. The preparer rejects unknown input fields, raw database URLs in secret-reference positions, unpinned/foreign image references, non-HTTPS origins, custom domains and payment credential/gate overrides. This first staging manifest does not enable payments. A future sandbox activation needs its own reviewed configuration and authorization.

### Operator gate 1 — project, billing, APIs and IAM

**Do not run this section until the exact project, billing account, region, expected spend and responsible operators are separately authorized.** Use a dedicated staging project and synthetic data. Selecting an existing shared production project is not an acceptable shortcut. Record project ID/number, approved region near the actual Neon region, billing owner and quotas. Google requires billing for deployment. [Deployment prerequisites](https://docs.cloud.google.com/run/docs/quickstarts/deploy-container).

The following shell snippets are Bash syntax for an operator's trusted terminal, not commands executed by this phase. Install a supported Google Cloud CLI, authenticate deliberately and set these non-secret identifiers; every `REPLACE_...` must be replaced with reviewed values. Keep credentials out of command arguments and shell history.

```sh
export PROJECT_ID='REPLACE_DEDICATED_STAGING_PROJECT'
export REGION='REPLACE_APPROVED_REGION'
export BILLING_ACCOUNT_ID='REPLACE_APPROVED_BILLING_ACCOUNT'
export SERVICE='lapalme-staging'
export REPOSITORY='lapalme-staging'
export RUNTIME_ACCOUNT='lapalme-staging-runtime'
export RUNTIME_SA="${RUNTIME_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com"

# AUTHORIZATION REQUIRED: creation and billing are not part of preparation.
gcloud projects create "$PROJECT_ID" --name='La Palme staging'
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID"
gcloud billing projects describe "$PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com --project="$PROJECT_ID"
# Only when preparing integration secrets:
gcloud services enable secretmanager.googleapis.com --project="$PROJECT_ID"
gcloud iam service-accounts create "$RUNTIME_ACCOUNT" --project="$PROJECT_ID" --display-name='La Palme staging runtime'
```

If an approved dedicated project already exists, verify it rather than running `projects create`. Project creation/billing association require the appropriate Resource Manager project-creation and Billing Account User/Project Billing Manager permissions; API enablement and service-account creation require separate administrative permissions. Enable control-plane IAM/Service Usage/Billing APIs only if the operator setup requires them. Do not enable Cloud SQL, GKE, Compute/VPC connectors, load balancers, Cloud Build or Cloud Scheduler for this local-build/manual-maintenance staging path.

| Identity | Minimum intended permission scope |
| --- | --- |
| Setup/billing administrator | Only the administrative permissions needed for approved project/billing/API/service-account setup; separate from runtime. |
| Human deployer | Cloud Run Developer on the dedicated staging project for initial service creation (later service scope where possible); Artifact Registry Reader/Writer on the staging repository; Service Account User on this runtime account. Separate IAM-policy authority is needed to grant testers access. |
| Runtime service account | Secret Manager Secret Accessor on each exact mounted staging secret only. No project Owner/Editor, service-account keys, migration-owner credentials, Scheduler administration or broad storage permissions. No Google API permissions are needed for the unconfigured bootstrap. |
| Approved testers | `roles/run.invoker` on this service. Application administrator authorization remains separate; Cloud Run access alone grants no admin role. |
| Google service agent | Preserve Google's automatically provisioned Cloud Run service-agent permissions. Verify its same-project image-pull access rather than granting the web runtime broad registry administration. |
| Future scheduler account | Only invoker on its approved target, with task-specific application authorization for a future HTTP endpoint. Do not use the Scheduler service agent itself as the caller account. |

No grants were issued here. [Deployment IAM](https://docs.cloud.google.com/run/docs/reference/iam/roles), [runtime identity](https://docs.cloud.google.com/run/docs/configuring/services/service-identity), [secret injection](https://docs.cloud.google.com/run/docs/configuring/services/secrets).

After those identities/repository exist and IAM changes are authorized, a setup administrator can grant the reviewed deployer principal (`user:...` or `group:...`, never a public principal) with the following scoped commands. Repeat the secret binding only for each approved mounted secret ID after creating its protected version:

```sh
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="$APPROVED_DEPLOYER_PRINCIPAL" --role=roles/run.developer
gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" --project="$PROJECT_ID" --location="$REGION" --member="$APPROVED_DEPLOYER_PRINCIPAL" --role=roles/artifactregistry.writer
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project="$PROJECT_ID" --member="$APPROVED_DEPLOYER_PRINCIPAL" --role=roles/iam.serviceAccountUser
gcloud secrets add-iam-policy-binding "$APPROVED_SECRET_ID" --project="$PROJECT_ID" --member="serviceAccount:${RUNTIME_SA}" --role=roles/secretmanager.secretAccessor
```

These are ordered by resource dependency: perform the registry grant after repository creation in gate 2, and secret grants after protected secret creation. The human creating/granting secrets needs separate administration authority; that authority is not granted to the deployer/runtime by this example.

Before deployment, create alerts at 50/80/100% of an explicitly approved total staging budget and a forecast threshold; verify recipients. Check eligibility for a service-scoped Cloud Run spend-cap budget. Current caps use gross estimates before credits, can overshoot during enforcement latency and pause service when reached; they do not cap registry/build/storage charges. Ordinary alerts-only budgets never enforce a spending limit. A cap can interrupt callbacks, so no sandbox session should start without sufficient coverage. No budget or cap was configured. [Budget alerts](https://docs.cloud.google.com/billing/docs/how-to/budgets), [current spend-cap conditions](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps).

### Operator gate 2 — repository, image and restricted deployment

After separate authorization, create **one private standard Docker repository**, in the selected service region. No repository/image push occurred here. Use local Docker builds so hosted Cloud Build is optional, not an implicit dependency. The existing verified Dockerfile/.dockerignore remain unchanged. Preserve the reviewed working-tree artifact: this checkout contains uncommitted earlier-phase work, so HEAD alone does not identify its image source. Record the reviewed source inventory, twelve migration hashes, unique release tag and resulting image digest; never commit automatically to manufacture provenance.

```sh
# AUTHORIZATION REQUIRED for cloud resources and publishing.
gcloud artifacts repositories create "$REPOSITORY" --repository-format=docker --location="$REGION" --project="$PROJECT_ID" --description='Restricted La Palme staging images'
gcloud auth configure-docker "${REGION}-docker.pkg.dev"
export RELEASE='REPLACE_UNIQUE_REVIEWED_RELEASE_TAG'
export IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/web:${RELEASE}"
docker build --platform linux/amd64 --build-arg SITE_INDEXING_ALLOWED=false -t "$IMAGE_TAG" .
docker push "$IMAGE_TAG"
gcloud artifacts docker images describe "$IMAGE_TAG" --project="$PROJECT_ID" --format='value(image_summary.digest)'
```

Use the returned **sha256 digest**, not the tag, in the offline preparer inputs. Verify the image manifest includes `linux/amd64`; local Windows `node_modules` must never be copied. No `.env` or private build argument is accepted. Then render the bootstrap service manifest. JSON is valid YAML for `gcloud run services replace`.

```sh
# AUTHORIZATION REQUIRED. Dry run contacts Google but does not deploy.
gcloud run services replace /absolute/private/staging.service.json --project="$PROJECT_ID" --region="$REGION" --dry-run
# Review validation and effective IAM before the separately authorized apply:
gcloud run services replace /absolute/private/staging.service.json --project="$PROJECT_ID" --region="$REGION"
gcloud run services get-iam-policy "$SERVICE" --project="$PROJECT_ID" --region="$REGION"
gcloud projects get-iam-policy "$PROJECT_ID"
gcloud run services add-iam-policy-binding "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --member='group:REPLACE_APPROVED_TESTER_GROUP' --role=roles/run.invoker
gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)'
```

The dedicated project must have **no effective `allUsers` or `allAuthenticatedUsers` invoker grant**, including inherited organization/folder/project policies. Do not assume replacing a service specification removes an existing public IAM binding. IAM checking is explicitly enabled; the ingress setting `all` permits Google-authenticated operator access over HTTPS, not anonymous access. Test an unauthenticated request and require denial before attaching integrations. No `--allow-unauthenticated`, IAM-check bypass, public admin registration or custom domain is part of staging. [IAM checking](https://docs.cloud.google.com/run/docs/securing/managing-access), [replace/dry-run](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/replace).

Read the assigned canonical origin from Google; do not derive or guess it. Rebuild with `--build-arg SITE_URL="$STAGING_ORIGIN" --build-arg SITE_INDEXING_ALLOWED=false`, push only after authorization, record its new digest, and render configured inputs with that same origin and pinned staging secret references. Static metadata/robots/headers require the rebuild; runtime variables alone do not update prerendered output. Create secret versions through the protected Secret Manager console or a reviewed secure input channel, grant runtime access only to named secrets, and never paste values into the manifest or a real `.env` file. No payment/retention gate changes are permitted by this preparation.

Before a subsequent apply, record the ready previous revision and its image digest, service JSON, IAM policy and pinned secret versions. Staging uses 100% traffic to latest on apply; perform it in a controlled test window with immediate smoke checks and rollback coverage. On failure, route 100% back to the recorded ready revision:

```sh
gcloud run revisions list --service="$SERVICE" --project="$PROJECT_ID" --region="$REGION"
# AUTHORIZATION REQUIRED for traffic changes; substitute the exact recorded revision.
gcloud run services update-traffic "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --to-revisions='REPLACE_PREVIOUS_READY_REVISION=100'
```

Rollback affects service traffic, not database schema, secret contents, media or provider payments. Keep the previous revision's secret versions and image available; never roll back schema or financial history automatically. New image application after a rollback must explicitly review its latest-traffic policy. [Revision rollback](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration).

`infra/cloud-run/cleanup-policy.json` proposes deleting only **untagged `web` images older than 30 days**, while retaining five recent versions. Apply it in **dry-run mode first**, only after authorization:

```sh
gcloud artifacts repositories set-cleanup-policies "$REPOSITORY" --project="$PROJECT_ID" --location="$REGION" --policy=infra/cloud-run/cleanup-policy.json --dry-run
```

Review the dry-run results before separately activating deletion. Retain tags for every deployed/current/rollback image, even if old; inspect revision references before removing any obsolete staging tag. Tagged images are not automatically removed by this policy, so tagged-version growth still needs bounded operator review. Keep policies do not know which revision the business needs. No cleanup policy was applied. [Cleanup behavior](https://docs.cloud.google.com/artifact-registry/docs/repositories/cleanup-policy).

### Operator gate 3 — isolated Neon and reviewed migration artifact

Use a **dedicated staging Neon project/database on PostgreSQL 17**, avoiding production branches/clones that contain customer data or share a compute/credential boundary. Confirm its actual free allowance, region and supported version. No Neon project or hosted connection was made. Use synthetic products/contact information only; do not run the development seed remotely or fabricate a production inventory.

The existing migration runner remains loopback-only and unchanged. The new offline preparer validates all twelve source files against `infra/cloud-run/migrations.sha256.json`, normalizing CRLF exactly as the original runner does. It outputs review SQL; it cannot execute SQL or connect anywhere. The output is intentionally **fresh-empty-database only**: expected database/user and PostgreSQL 17 checks, the same session advisory lock `(1279348813,2)`, empty-user-schema checks, one transaction per unchanged migration, exact ledger validation, checksum stamping from 0006 onward, and explicit nonzero failure. It refuses replay. Partial execution leaves a committed valid prefix: stop and review; do not rerun the fresh-only script, reset the database or bypass the local runner. A resume artifact requires separate exact-prefix review/authorization.

Hosted execution requires a second operator to approve the **exact Neon project/endpoint/database/migration identity, reviewed source inventory and generated SQL SHA-256**. Independently compare all twelve pinned checksums to the accepted release. The local rehearsal confirms artifact behavior, not hosted permission or schema validity. For any existing data, take and test an encrypted backup first. A nonempty/unexpected target is a stop condition, not a request to add a reset option.

Use a direct/session-preserving endpoint for migration locks and backups. In the operator's protected libpq environment, set exact `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, credential input and `PGSSLMODE=verify-full` with trusted certificate roots where necessary. Scrub inherited `PGHOSTADDR`, `PGSERVICE`, `PGSERVICEFILE`, `PGOPTIONS` and other destination overrides first; never supply a credential-bearing URL in argv. Verify endpoint/database identity and run from `psql -X` with no startup file:

```sh
# AUTHORIZATION REQUIRED; connection credentials are already in protected input.
psql -X --no-password --set=ON_ERROR_STOP=1 \
  --set=expected_database="$APPROVED_STAGING_DATABASE" \
  --set=expected_user="$APPROVED_MIGRATION_ROLE" \
  --file=/absolute/private/staging-migrations.review.sql
```

Client-side `verify-full` and approved endpoint custody are mandatory; SQL target names alone do not verify TLS or a cloud project. Record successful completion, compare all twelve ledger rows/checksums and inspect schema/constraints. Provision separate restricted catalogue/admin/cart/payment/media-maintenance/backup roles through the grant lists in `database-schema.md` and the Phase 11 media role above; audit effective privileges, PUBLIC/inherited grants, memberships and DDL denial. The migration-owner credential never enters the web runtime. Provision the initial staging administrator only through the existing reviewed operator CLI with a protected password; signup stays disabled.

Runtime pg pools remain capped at four clients per access role, potentially sixteen per application instance, plus jobs/operators and rollout overlap. Start with direct Neon endpoints and verify TLS, transactions, timeouts, idle disconnect/reconnect and cold resume. Do not select a pooler solely because it advertises many clients: current pg startup timeout parameters may be unsupported by transaction pooling. Preserve those protections and validate the exact endpoint rather than deleting timeouts to connect. [Neon connection restrictions](https://neon.com/docs/connect/connection-errors). No hosted migration, grant, session, transaction or pooled endpoint was tested.

### Environment classification and HTTPS checks

All names below are exact existing settings; no real values are displayed or stored. Public classification does not mean adding a `NEXT_PUBLIC_` variable.

| Class | Exact names | Staging handling |
| --- | --- | --- |
| Public deployment/build values | `SITE_URL`, `SITE_INDEXING_ALLOWED`, `NEXT_STANDALONE`, `PORT`, `HOSTNAME`, `NODE_ENV`, `NEXT_TELEMETRY_DISABLED` | Confirmed origin at build/runtime; indexing false; standalone build enabled; port 8080; production Node cookie semantics. |
| Server-only origins/proxy policy | `BETTER_AUTH_URL`, `CART_ORIGIN`, `ADMIN_TRUSTED_IP_HEADER` | Same exact canonical HTTPS origin. Trusted IP header remains unset; Cloud Run forwarding alone does not establish either supported header's trust. |
| Web database credentials | `DATABASE_URL`, `ADMIN_DATABASE_URL`, `CART_DATABASE_URL`, `PAYMENT_DATABASE_URL` | Independent least-privilege staging roles in the same isolated DB; Secret Manager references. Payment URL absent initially. |
| Authentication secret | `BETTER_AUTH_SECRET` | Unique staging random secret, identical across revisions/instances; never reuse production. Four core secret versions including three database URLs. |
| Readiness gates | `CHECKOUT_DRAFT_RETENTION_READY`, `PAYMENTS_TEST_ENABLED`, `PAYMENTS_RECONCILIATION_READY` | False throughout preparation and initial restricted manifest. No bypass or claimed scheduled coverage. |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Separate authorized test environment; cloud name is non-confidential configuration; API key/secret server-only, two optional secret versions. |
| Paymob sandbox | `PAYMOB_MODE`, `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_HMAC_SECRET`, `PAYMOB_API_KEY`, `PAYMOB_INTEGRATION_ID`, `PAYMOB_OWNER_ID` | Mode test only; supplied by authorized sandbox merchant, never invented. Keep sensitive keys in secret storage; IDs remain server-only configuration. Public key is used only in the existing hosted-checkout flow. Not mounted by initial preparer. |
| Task-only credentials | `MEDIA_CLEANUP_DATABASE_URL`, `BACKUP_DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, `PG_BIN`, `PGSSLROOTCERT` | Separate protected operator/task environment; encryption key separate from archives. Never inject backup/migration credentials into web service. |
| Local recovery/provisioning only | `RESTORE_DATABASE_URL`, `ADMIN_PROVISION_PASSWORD` | Fresh disposable loopback restore only; hidden provisioning input preferred, never a persistent web secret. |

The guest cart uses its existing server-generated HttpOnly/Secure/SameSite=Lax host-only cookie; there is no new cart-signing secret or customer login. Better Auth remains HttpOnly/Secure/SameSite=Strict, signed, eight-hour expiry, no public registration and database-backed authorization/revocation. Exact Origin/Fetch Metadata checks stay intact. Admin roles still reload from the trusted database. No security check is weakened for staging.

Private Cloud Run invocation must be tested independently from app cookies. The documented `gcloud run services proxy` serves **HTTP localhost**, which is useful for simple smoke requests but does not reproduce the real HTTPS origin and Secure-cookie flow. For full browser checks, navigate the actual HTTPS staging URL with an authorized tester identity token injected **only for that exact origin**, using raw CDP `Fetch.requestPaused` interception and `X-Serverless-Authorization`. Validate the target separately for every request and redirect hop; avoid global headers and ordinary Playwright route header overrides, which can propagate to redirect destinations. Obtain tokens securely for the canonical service audience; never log/store them or attach them to external Paymob/Cloudinary requests. Keep normal browser Origin/Host unchanged. Verify unauthenticated denial, valid/invalid admin login, logout revocation, tampered/expired cookies, guest ownership, cross-session denial and cross-origin mutation rejection only after the harness, administrator and required fixtures are separately approved. This scoped hosted-browser setup is planned, not run; Step B1 below records the concrete proxy analysis and testing prerequisites. [Private invocation](https://docs.cloud.google.com/run/docs/triggering/https-request), [service-to-service tokens](https://docs.cloud.google.com/run/docs/authenticating/service-to-service), [CDP Fetch protocol](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Fetch.pdl).

### Paymob and Cloudinary authorization checklists

**A private Cloud Run service blocks Paymob's ordinary unauthenticated webhook before the application.** There is no safe per-path IAM exception in this prepared single-service setup. No callback-capable public staging configuration is authorized here. Before genuine sandbox tests, obtain a separately reviewed reachability plan that preserves restricted administration/application privacy and does not rely on the browser return as payment evidence. Do not start an intention while callback and reconciliation coverage are unresolved. No proxy/backend/load balancer or forwarding service was added to work around this gate.

After explicit sandbox-transaction authorization, supplied test merchant credentials and approved monitored scheduling/retention coverage, the operator checklist is:

1. Confirm Egypt sandbox merchant, fixed integration/owner IDs, test-prefixed credentials, confirmed same-origin callback/return paths and accessible HTTPS delivery; prove anonymous callbacks reach only the intended existing HMAC handler under the separately approved access design.
2. Save/review synthetic checkout details under the existing guest cookie; compare authoritative EGP amount, items, fulfillment snapshot and order/attempt references. Configure both Private Delivery and an authorized synthetic Boutique Collection location.
3. Create one intention through the actual UI; validate response correlation/test mode and fixed hosted-checkout destination. Use only Paymob's authorized sandbox instructions, never real payment credentials or invented test card data.
4. Complete an actual sandbox success and failure; verify authenticated HMAC receipt, owner/integration/order/amount matching, immutable history, reservation consumption/release exactly once and customer ownership. Reject tampered callbacks.
5. Exercise return redirect separately: it must redirect to the fixed owned order page without changing payment state. Confirm private/no-store/no-referrer responses and no key/client-secret leakage to logs or third-party requests.
6. Re-deliver an authenticated duplicate under controlled authorization; confirm no duplicate stock/order action. Check a known failed retry; never retry an ambiguous intention automatically. Exercise out-of-order/late success and operator escalation without fabricating a paid row.
7. Run authenticated inquiry/reconciliation, inspect remaining exceptions and stale holds, and verify failure detection. Provider timeout/not-found never authorizes uncertain stock release. Confirm the operator can disable new initiation while keeping settlement verification available.

No merchant credentials, intention, transaction, callback or provider retry guarantee was claimed. Existing local payment mocks remain synthetic regression evidence. [Paymob HMAC contract](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback).

For Cloudinary, authorize a separate disposable test cloud/environment and harmless synthetic photographs first. A folder alone is not a credential-isolation boundary when a key can delete other assets. Preserve the existing server-generated namespace and authenticated asset type. Verify authenticated upload, complete Sharp decode/MIME/frame/size/pixel validation, orientation/metadata removal and provider response signature; association only after verification. Confirm unauthorized admin denial, private draft preview, publication-gated public delivery and denial after unpublish. Test interrupted upload cleanup, retryable deletion, referenced-asset protection and SYSTEM audit using only test-owned assets. Do not delete client photography or run account-wide cleanup. No real upload/read/delete was performed. [Response signatures](https://cloudinary.com/documentation/response_signatures).

### Economical maintenance design — inactive during preparation

Default restricted staging has no stored checkout drafts/payments because its gates remain false. **No automated schedules are activated or proposed as a default one-minute Job loop.** For a later authorized test window, use the existing trusted operator commands with task-specific credentials, explicit start/end coverage and recorded results. Avoid unconditional polling of an idle staging database. If synthetic data needs retention/backup beyond a test window, an accountable operator must approve and run the schedule below; manual availability is not a production reliability guarantee.

Measured single local Windows executions, including Node process startup, on small synthetic fixtures:

| Command/work | Process wall time | Node CPU | Peak process RSS |
| --- | --- | --- | --- |
| Purge one expired draft | 236 ms | 390 ms | 86.7 MiB |
| Reconcile one pending mocked payment | 316 ms | 421 ms | 104.3 MiB |
| Cleanup one mocked deletion | 317 ms | 375 ms | 91.6 MiB |
| Encrypted small-fixture backup | 428 ms | 235 ms | 81.2 MiB |

These are local samples, not Linux/Google measurements or upper bounds; child `pg_dump` CPU/RSS is not included in Node's metrics. Parallel CPU can exceed wall time. The reconciliation sample left the uncertain reservation **ACTIVE**. Cloud billing depends on allocated resources and billed duration, not the Node CPU number. Plan a two-second HTTP request scenario and a 60-second minimum Job scenario until hosted durations are measured.

| Task | Proposed staging frequency / resource / deadline | Overlap, retries and failure evidence |
| --- | --- | --- |
| Draft purge | Before/after a controlled window; at least hourly if draft saving is later authorized. 1 CPU/1 GiB; operator timeout 300 s. Future HTTP proposal: bounded batch/request within 30 s. | Existing row locks/SKIP LOCKED and safe expired-only deletes. Run separately from financial work. Log count/duration/oldest backlog; retry boundedly, alert after a missed hourly completion. |
| Payment + reservation reconciliation | No idle schedule with payments off. During a separately approved payment window, every minute while any attempt is unresolved, plus operator handover until settlement. Limit 1 initially; 1 CPU/1 GiB; 60 s operator/task deadline. | Same existing 45 s durable claim leases, idempotent observations and retained uncertain holds; no independent release cron. Checked != resolved. Alert on missed minute, provider failure or backlog; escalate within the existing hour policy. A test window cannot end with unowned pending work. |
| Media cleanup | Before/after media tests and every five minutes while cleanup is pending. Limit 1 initially; 1 CPU/1 GiB; 60 s deadline. | Existing five-minute leases/generation checks. Exit 2 means backlog, not success. Alert on old pending records or provider failure; retry without deleting referenced assets. |
| Database backup | Once daily while retained staging data matters, plus pre-migration; choose explicit UTC time (e.g. 02:00 UTC), not a timezone-dependent DST assumption. 1 CPU/1 GiB; max 900 s, existing individual tool timeouts retained. | Separate backup task/role/key. Single task, concurrency one plus scheduler/operator lock; unique ciphertext output path per run. Retry at most once after failure; verify nonempty authenticated archive and off-device receipt, alert before next daily deadline. |

No unrelated tasks are combined to fit Scheduler's free allowance. Existing leases do not replace completion/backlog monitoring; backup/purge need scheduler-level serialization. Logs contain task name, run ID, counts, duration, safe failure code and last-success timestamp—never credentials, signed URLs, cookies or raw customer/payment payloads. Track missing executions as well as failed ones, assign recipients and test alert delivery before any readiness acknowledgement. Restore/key recovery and backup-destination authorization remain separate gates.

| Future execution approach | Authentication and feasibility | Cost consequence |
| --- | --- | --- |
| Scheduler → authenticated HTTP inside the existing Next service | OIDC for exact service audience, dedicated caller, plus application verification of an allowlisted machine identity/task. **No such maintenance HTTP routes exist today.** Do not schedule `/`, admin UI or arbitrary shell commands as a substitute. A future endpoint needs separate implementation/security review and synchronous bounded completion within request timeout. | Request billing with no Job one-minute floor; cold start and database work still count. Existing service 1 CPU/1 GiB and max 2 remain shared capacity, not dedicated maintenance capacity. |
| Scheduler → Cloud Run Jobs API | OAuth for the `run.googleapis.com` API, least-privilege job invocation; task identity has only task secrets. Separate source/job packaging is required: web standalone image deliberately omits scripts/PG tools. None is deployed here. | Every started task has a one-minute minimum; independent failure/retry boundary, but costly for minute-by-minute short work. |
| Trusted existing operator runner | Protected CLI environment, exact staging target, task serialization and recorded completion; no web endpoint. | No new cloud execution charge; operator availability and runner/storage costs still exist. Suitable only for bounded staging windows with explicit responsibility. |

Use OIDC for a Cloud Run HTTP target and OAuth for Google Jobs API calls; do not confuse token audience with URL query parameters. Scheduler delivery/retries are at-least-once and may overlap with an unfinished target; preserve durable application guards, cap retries, and avoid retrying financial mutations. HTTP 200 or Jobs API launch acceptance is not proof of resolved business work. [Scheduler HTTP authentication](https://docs.cloud.google.com/scheduler/docs/http-target-auth), [Jobs scheduling](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule).

At 31 days, a hypothetical two-second, 1-CPU/1-GiB HTTP reconciliation each minute uses 89,280 CPU/GiB seconds and 44,640 requests: about **$2.38 gross**, potentially within otherwise-unused request-based allowances. The analogous one-minute Job minimum consumes 2,678,400 CPU/GiB seconds: about **$53.57 gross / $48.35 after otherwise-unused Job allowances**. These calculated scenarios omit retries, starts beyond the estimate and other services. They are not interchangeable or a recommendation to create either loop. Both would keep Neon active: 0.25 CU continuously is **186 CU-hours/month**, exceeding Free's 100. Event/window-aware operation must guarantee continuation for unresolved attempts; simply querying for work every minute is still polling. [Cloud Run pricing](https://cloud.google.com/run/pricing), [Neon limits](https://neon.com/docs/introduction/plans).

### Monthly planning model and cost controls

All estimates are USD before tax, using published reference pricing reviewed on 2026-10-28, with no actual Google usage measurement. Free allowances can already be consumed by other projects/accounts; region, destination, retries, cold starts and retained revisions affect the bill. No commitment, paid plan or new paid ancillary service is approved.

Illustrative **manual staging** month: 100,000 requests; 10,000 allocated vCPU-seconds and 10,000 GiB-seconds including starts; 1 GiB average registry storage; 1 GiB ingested logs; four core secret versions and 1,000 accesses; local builds; no Jobs/Scheduler. Assume 10 GiB billable internet output and a **planning rate** of $0.15/GiB for Egypt/Africa, to be replaced by the exact selected-region/destination quote before authorization.

| Item | Allowance / overage basis | Scenario estimate if allowances otherwise unused |
| --- | --- | --- |
| Cloud Run service | 180k vCPU-s, 360k GiB-s, 2M requests; reference excess $0.000024/vCPU-s, $0.0000025/GiB-s, $0.40/M requests | $0 after allowance; $0.305 gross before allowance |
| Cloud Run Jobs | Not used by default. 1 CPU/1 GiB daily backup task, if later packaged/authorized, has at least 1,860 billed CPU/GiB seconds/month | Default $0; daily example $0.0372 gross before Job allowance, excluding storage/transfer |
| Cloud Scheduler | Three jobs/account/month free, then $0.10/job/31 days | Default $0; four independent schedules would add $0.10 if the free three are available. [Scheduler pricing](https://cloud.google.com/scheduler/pricing). |
| Artifact Registry | 0.5 GiB-month free/account, roughly $0.10/GiB-month overage; compressed/deduplicated registry usage differs from local image size | 1 GiB-month → about $0.05. Scanning/transfer and retained job images are extra. [Registry pricing](https://cloud.google.com/artifact-registry/pricing). |
| Cloud Build | Local Docker build selected. Optional e2-standard-2 default pool: 2,500 promotional minutes/account, then $0.006/min | $0 hosted-build use; local machine/network cost excluded. [Build pricing](https://cloud.google.com/build/pricing). |
| Internet/network transfer | Meter by actual source/destination and Premium Tier rates. North American free output is not a free allowance for Egyptian visitors. Include app-proxied Cloudinary bytes and Neon traffic. | 10 GiB × assumed $0.15 = $1.50; replace assumption with quote. [Network pricing](https://cloud.google.com/vpc/network-pricing). |
| Logging | First 50 GiB/project/month, then $0.50/GiB ingestion; retention beyond 30 days $0.01/GiB-month | 1 GiB / ≤30 days → $0; use short approved retention, minimize request URL/query retention and debug logs, retain required audit history separately. [Logging pricing](https://cloud.google.com/products/observability/pricing). |
| Secret Manager | Six active versions/account and 10,000 accesses free; roughly $0.06/version-month and $0.03/10k excess accesses | Core four → $0; optional media brings total to six. Extra sandbox keys, old active versions and other projects can produce charges. [Secret pricing](https://cloud.google.com/secret-manager/pricing). |

Under those assumptions only, the illustrated infrastructure subtotal is **about $1.55/month**, not a quote or zero-dollar guarantee. Additional monitoring/alerting, storage, backups, secret versions, registry scanning, heavy imagery, traffic or missing shared allowances change it. Domain renewal and actual Paymob merchant fees remain separate. No external backup storage or notification service is silently provisioned to fit this number. Account for Neon Free's 1 GB/project, 100 CU-hours and 5 GB/month transfer, and Cloudinary's shared free credit budget independently.

Keep min 0, max 2, concurrency 4 and bounded timeouts; inspect effective scaling after every update. Apply billing alerts/spend-cap eligibility review, strict IAM, no source-based implicit Cloud Build, no VPC/load-balancer resources, short log retention, registry dry-run cleanup and explicit image rollback retention. Do not generate traffic or health polling to keep anything awake. Monitor cost and Neon usage during each authorized test window; turn off new test initiation before coverage is exhausted while preserving callback/reconciliation obligations.

### Verification, cleanup and operator handoff

Initial Git state: `master` at `3ab5bf1d00f0aebdfac147dbb8c36e560cf2b782`, **nine modified / fifteen untracked**, nothing staged. All earlier Phase 11/11B files were present. The new phase adds only the four `infra/cloud-run` JSON files, offline `scripts/prepare-staging.mts` and `tests/staging.test.mts`; modifies only package scripts and this existing readiness document. No dependency/lockfile, Dockerfile, app source, photography, CSS or migration change is intended.

| Phase 11C verification | Result |
| --- | --- |
| `npm run lint`, `npx tsc --noEmit`, `npm run build` | PASS; no integration secrets required. Final renderer changes also passed focused staging, TypeScript and lint checks. |
| Existing application integration and browser regressions | 225 integration + 43 browser cases PASS; synthetic provider flows, auth, cart/checkout, native images, transactions and privacy assertions retained. |
| New `npm run test:staging` | 5/5 PASS: private/off-gate bootstrap, pinned secret references, invalid/unsafe inputs, output-path/overwrite guards and real local PostgreSQL execution of the generated migration artifact. |
| Migration rehearsal | Exact twelve-file ledger/checksums matched; wrong expected target and replay rejected with nonzero status and no unintended writes. Existing remote-execution guard unchanged. |
| Linux AMD64 container revalidation | `npm ci`, standalone build and public/protected route smoke PASS; Node 22.23.4, Sharp 0.35.5, UID 1000. Tests/scripts/db/infra and `.env` files absent from image. Health healthy; SIGTERM stop 397 ms, exit 143, no OOM. No full Linux integration rerun is claimed for 11C. |
| Visual checks | Existing Playwright 1.55.0/Chromium fallback (Browser plugin not available). Desktop 1440×1000 pixels identical; mobile 390×844 differs in 0.2072% of pixels, maximum 2/255 per channel, within unchanged 2.5%/8-channel limits. Screenshots visually inspected. Menu open/Escape close, meaningful content, identity, image/console/overlay and existing interaction checks pass. |
| Source preservation | Starting inventory has 237 files; only this document and `package.json` changed. Application code, styles, assets, Docker inputs other than package scripts, lockfile and all migrations are byte-preserved. Six new preparation/test files added. |

**273 distinct local test cases pass** (230 integration/preparation + 43 browser); focused reruns do not increase that count. No dependency was installed in the application or upgraded. The local container installation used the unchanged lockfile. Actual Google schema acceptance, IAM, image publication/pull, Neon TLS/resume/grants, real sandbox payment/callbacks, Cloudinary, alert delivery, schedules, domain and billing remain **PENDING**.

Cleanup completed for phase-owned resources: removed its local container/image, the one exact build record and 17 cache IDs absent from the starting Docker inventory (1.191 GB reported), synthetic databases/roles, TLS material, screenshots, timing backup, logs and marked scratch directory. Fixture database/role queries returned no leftovers; temporary servers/listeners were stopped. Shared base-image tags, unrelated Docker resources, the running existing PostgreSQL service, all earlier phase work and normal ignored Next build outputs were preserved. Original TypeScript build-info bytes and initial stopped Docker state were restored. No Git clean/reset, commit, push or cloud action occurred.

Final verified Git state: same `master`/`3ab5bf1`, **nine modified / twenty-one untracked files**, nothing staged; phase scratch directory absent. New files:

```text
infra/cloud-run/staging.template.json
infra/cloud-run/staging.inputs.example.json
infra/cloud-run/cleanup-policy.json
infra/cloud-run/migrations.sha256.json
scripts/prepare-staging.mts
tests/staging.test.mts
```

Operator actions remain gated: approve the dedicated project/billing/region/IAM/budget; review source inventory and artifacts; separately authorize repository/image publication and restricted bootstrap; verify anonymous denial and HTTPS; authorize isolated Neon/secret/grant/provisioning setup and exact migration SQL; then run the hosted checklist. Genuine sandbox payments additionally require an approved reachable-callback access design and monitored retention/reconciliation/backup coverage. Do not assume the private bootstrap can receive Paymob callbacks or that CLI commands are HTTP maintenance endpoints.

**PASS — Phase 11C offline staging preparation. HOSTED STAGING NOT VERIFIED; PRODUCTION NOT READY.** Stop here. No deployment, Google/Neon resource, billing, DNS, live provider operation, real payment, schedule activation or readiness-flag enablement is authorized or performed by this phase.

## Phase 11F-A staging runtime identity review (2026-10-30)

This is a prepared approval artifact, not evidence that hosted roles were created.
The exact SQL is [staging-runtime-roles.review.sql](../infra/neon/staging-runtime-roles.review.sql).
Reviewed SQL SHA-256:
459692b229613cb0cf168d2ea05222ed6bad759d9c82cb40957cc30521d436ce.
This pins the tested artifact; it does not record operator approval.
The reproducible local rehearsal is npm run test:runtime-roles, using an explicit
disposable PostgreSQL **18.6** loopback cluster with SCRAM host authentication for
all six fixed runtime identities,
TEST_DATABASE_URL and PG_BIN pointing to PostgreSQL 18 tools. The six fixed names
require an exclusive cluster. Never run fixture tests on Neon.
The legacy fixture helpers create passwordless random local roles. In the
network-isolated rehearsal, those fixture roles retain loopback trust while a
preceding HBA rule requires SCRAM for all six fixed identities. Full-cluster
SCRAM makes the existing helpers' eager auth connections stall during cleanup;
this is a local fixture limitation, not a change to hosted authentication.

The finalized rehearsal passed all eight tests: actual SCRAM login/wrong-password
checks, the effective ACL matrix across 38 tables and 419 columns, migration/DDL/
private-data denial, application authentication and human authorization, catalogue/
cart/checkout/signed-mock payment/fulfillment paths, cleanup/audit and encrypted
PG18 backup. Mid-plan failure rolled back every role; lock contention, replay and
wrong-target guards failed safely. Fixture database and role teardown passed.
The existing 232 non-browser regressions also passed on a separate disposable
PostgreSQL 18.6 cluster. Lint, TypeScript and the production build passed from a
credential-free source snapshot. A final hosted read-only check confirmed all
37 business tables still empty, all twelve pinned ledger entries unchanged,
no PUBLIC column/table grants, no public functions, and no runtime roles created.

Read-only inspection used NEON_STAGING_DIRECT_URL, exact direct hostname
ep-wispy-feather-b95dea30.c-7.eu-central-1.aws.neon.tech, database
la_palme_dor_staging, neondb_owner, PostgreSQL 18.6, a writable primary, libpq 18
verify-full with trusted roots and required channel binding. Client TLS was
1.3 / TLS_AES_256_GCM_SHA384 / 256 bits. Project green-glitter-95493455, staging
branch br-rough-term-b9hae0t4 and compute ep-wispy-feather-b95dea30 are linked by
the operator's verified Console evidence; this is not independent API access.
All twelve ledger records matched the pinned manifest. All six names were absent.
Provider roles and the owner's existing neon_superuser membership remain untouched.

| Environment / custody | Proposed LOGIN role | Cumulative scope |
| --- | --- | --- |
| DATABASE_URL | lapalme_staging_catalogue | SELECT on eleven catalogue tables; application publication/projection checks remain mandatory. |
| ADMIN_DATABASE_URL | lapalme_staging_admin | Phase 05 authentication, Phase 06 catalogue and Phase 10 fulfillment, with documented column restrictions and append-only audit writes. |
| CART_DATABASE_URL | lapalme_staging_cart | Five catalogue tables, boutique reads, cart/item/counter/draft grants from Phases 07–08. |
| PAYMENT_DATABASE_URL | lapalme_staging_payment | Exact Phase 09 order/payment/reservation/reconciliation grants. Keep absent from Cloud Run. |
| MEDIA_CLEANUP_DATABASE_URL | lapalme_staging_media_cleanup | Jobs, four updateable job columns, two product-media reference columns, audit INSERT. Operator/task only. |
| BACKUP_DATABASE_URL | lapalme_staging_backup | SELECT on all 38 current tables, including sensitive auth/payment records and ledger. Operator only; default read-only. |

All six identities have NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT,
NOREPLICATION and NOBYPASSRLS, no memberships, ownership or persistent CREATE.
No runtime may modify schema_migrations; only backup may SELECT it. No future
default privileges are added. There are no sequences or sequence grants.
Existing PUBLIC CONNECT/TEMP defaults remain; TEMP does not grant persistent
public-schema CREATE. Global revocation would affect other identities/databases
and is outside this plan. SQL service grants do not enforce publication or
human/guest authorization: Better Auth and repository checks remain mandatory.

Start all current Node pg pools on direct connections with verified TLS and
unchanged pool/time limits. Transaction-pool compatibility with startup timeouts
is unverified. Migrations and libpq backups require direct connections. Node pg
enables channel binding but does not enforce libpq's require policy; do not
claim otherwise or weaken TLS. Owner credentials never enter the web service.
No Secret Manager, Cloud Run or payment activation is authorized by this review.

### Approval and execution order

1. Review and pin the SQL SHA-256 and twelve migration hashes. Obtain explicit
   approval for these six identities and this artifact, separately from migrations.
2. Reconfirm Console project/branch/compute binding. Reconnect securely and
   recheck primary, version, TLS/channel binding, ledger, ownership, PUBLIC ACLs
   and role absence. Stop on drift without correcting it.
3. After approval generate six independent random 32-byte base64url passwords
   in process memory. Establish recoverable protected operator custody before
   commit: an ACL-restricted CurrentUser-DPAPI-encrypted bundle outside this
   repository, with a successful decrypt check that prints no values. Never
   persist plaintext passwords or place them in argv/history/logs. Do not create
   Secret Manager secrets during this phase.
4. Use a reviewed libpq 18 launcher that scrubs all inherited PG routing overrides
   (especially PGHOSTADDR, PGSERVICE, PGSERVICEFILE, PGPASSFILE and PGOPTIONS).
   Set the exact PGHOST, PGPORT=5432, PGDATABASE=la_palme_dor_staging,
   PGUSER=neondb_owner, protected PGPASSWORD, PGSSLMODE=verify-full, trusted
   PGSSLROOTCERT and PGCHANNELBINDING=require. Pass the six secrets only through
   PHASE11F_PASSWORD_CATALOGUE, PHASE11F_PASSWORD_ADMIN, PHASE11F_PASSWORD_CART,
   PHASE11F_PASSWORD_PAYMENT, PHASE11F_PASSWORD_MEDIA_CLEANUP and
   PHASE11F_PASSWORD_BACKUP. After approval/checks set PHASE11F_TARGET_APPROVED to
   green-glitter-95493455/br-rough-term-b9hae0t4/ep-wispy-feather-b95dea30/la_palme_dor_staging.
   The marker is not cloud identity proof. Never enable local_rehearsal on Neon.
5. Reverify the pinned file digest, then execute the command below. It **mutates
   roles and grants**. Target/version/ledger/role/ownership/PUBLIC guards precede
   role changes. All creation/settings/grants commit together under a transaction
   advisory lock. Local rehearsal requires loopback client/server, postgres
   ownership and a random marked fixture database.

       psql -X --no-password --set=ON_ERROR_STOP=1 --file=infra/neon/staging-runtime-roles.review.sql

6. Reconnect with each actual LOGIN and its own protected secret using the same
   TLS policy. Inspect effective attributes/membership/ownership and schema,
   table, column and sequence privileges. Verify permitted projections and denied
   private reads, migration changes, DDL, financial edits and backup writes using
   zero-row operations in transactions that always roll back. Check backup ACL
   denial separately after disabling its read-only default. Do not create hosted
   fixtures or run local integration tests there.
7. Recheck the ledger/checksums and empty business tables. Remove process secrets
   and scratch; report outcomes before any Cloud Run integration.

### Failure and recovery

ON_ERROR_STOP halts on any error. Disconnect before COMMIT rolls back role creation,
role settings and grants together. Replay refuses existing names, without resetting
passwords or permissions. The lock releases at commit/rollback/disconnect. A lost
connection at COMMIT has an uncertain outcome: inspect all six identities and ACLs
read-only before deciding what happened; never rerun blindly.

After a committed verification failure, stop integration and retain encrypted
credentials for diagnosis. Disabling LOGIN, rotating secrets or correcting ACLs
requires separately reviewed operator authorization. Never automatically DROP ROLE,
DROP OWNED, reset a branch or change migrations. NOLOGIN alone does not terminate
existing sessions; later incident recovery must consider them explicitly.

### Authorized hosted provisioning outcome (2026-10-30)

The operator explicitly approved the six identities and pinned SQL SHA-256 above.
Fresh preflight verified the exact staging endpoint/database, PostgreSQL 18.6
primary, client verify-full TLS 1.3, required channel binding, all twelve ledger
checksums, the accepted schema counts, all six names absent and all 37 business
tables empty. Source hashes were unchanged since the passing local rehearsal.

Six independent 32-byte credentials were generated and encrypted with Windows
DPAPI CurrentUser in an operator-only ACL-protected directory outside this
repository. Recovery succeeded before execution, including retrieval in a fresh
process. The encrypted bundle and its non-printing import helper are retained;
no Secret Manager or Cloud Run configuration was changed.

The exact approved artifact executed once and COMMIT was confirmed. All six roles
were created with their reviewed grants. The artifact's pre-COMMIT attributes and
membership exclusion checks passed. Its source bytes and migration files were
unchanged.

Hosted verification is **PARTIAL**. The actual catalogue LOGIN passed verified TLS,
identity, attribute/membership/ownership/schema checks, all 304 table and 1,676
column privilege checks (including no grant options), and four permitted read
checks. Its subsequent rollback-only negative permission batch exited with
SQLSTATE XX000. The wrapper suppressed raw server diagnostics; the precise
failing statement and server cause were not established. This does not establish
that a forbidden operation was allowed.

All hosted operations stopped at that failure, without retry, ACL correction,
role recreation or password rotation. Verification of the other five actual
LOGINs, the remaining negative checks and the final post-provision ledger/schema/
empty-table recheck remain incomplete. The failed psql transaction disconnected
under ON_ERROR_STOP and rolled back. No customer/order/payment fixture was
created; positive DML checks were restricted to zero-row operations with ROLLBACK.
Further diagnosis requires a separately authorized continuation. Preserve the
encrypted credentials and inspect the existing roles rather than rerunning the
creation artifact.


## Phase 11F simplification: one restricted application identity (proposal)

This proposal follows the operator's decision to use one SQL runtime identity.
It does not provision hosted roles or configure Cloud Run. The six existing
hosted identities and their DPAPI credential custody remain unchanged. Their
previous partial verification and SQLSTATE XX000 remain documented above; the
error establishes neither a successful nor a failed permission bypass.

The exact proposal is [staging-app-role.review.sql](../infra/neon/staging-app-role.review.sql).
Tested SQL SHA-256:
97cc686fbb988fa5bca18b170086d486b880a66601d08c6ae5d1e322d7ddd660.
It creates only lapalme_staging_app, without memberships, ownership, SUPERUSER,
CREATEDB, CREATEROLE, BYPASSRLS, replication, grant options or persistent CREATE.
Its explicit grants are the union of the existing catalogue, authentication/admin,
cart/checkout and payment contracts: SELECT on 32 tables, INSERT on 26, full
UPDATE on 14, DELETE on nine, plus the existing restricted UPDATE columns on
admin_users, boutique_locations, orders, fulfillment_arrangements, payments,
payment_events and inventory_reservations. No sequences exist or need privileges.

No access is granted to schema_migrations, customer_profiles, customer_addresses,
bespoke_requests, appointment_requests or product_enquiries. Administrator/credential
provisioning, financial snapshot edits, financial/history deletes and audit rewrites
remain prohibited. Backup is excluded. Media cleanup's current permissions are
already contained in the combined admin scope, so its existing operator command
needs no additional grant.

Consolidation removes database privilege separation between public, cart, admin
and payment paths. A server-side database-access vulnerability in any such path
could reach authentication/session records, private order/payment reads and the
combined mutation scope. Better Auth, human roles, guest ownership, publication
projections, HMAC verification, idempotency, row locks, state transitions, validation,
CSRF/Origin checks and audit code are unchanged and remain mandatory.

### Runtime mapping and connection budget

| Existing variable | Prepared identity / connection |
| --- | --- |
| DATABASE_URL | lapalme_staging_app, same protected application URL |
| ADMIN_DATABASE_URL | Same application URL; Better Auth and human authorization unchanged |
| CART_DATABASE_URL | Same application URL; guest ownership unchanged |
| PAYMENT_DATABASE_URL | Same application URL only after separate payment activation approval; keep deferred now |
| MEDIA_CLEANUP_DATABASE_URL | May use the same role in the existing operator/task context; no scheduler/provider activation |
| BACKUP_DATABASE_URL | Existing separate lapalme_staging_backup, operator only, direct endpoint |
| NEON_STAGING_DIRECT_URL | neondb_owner, protected operator migrations/administration only; never web runtime |

No variable is renamed or removed, no new dependency is required, and no runtime
code change is needed. Identical URLs do not merge the existing pools: the shared
client module creates three lazy pools and Better Auth uses one admin pool, each
capped at four. Full activation is therefore bounded at 16 connections per instance,
32 across two Cloud Run instances; while the payment pool remains unused the bound
is 12/24. Allow additional headroom for operator/task connections and deployment
overlap, and verify actual Neon capacity before later integration. No pool is
enlarged or added. Reducing their number would require an unnecessary ownership/
lifecycle refactor for this preparation.

Keep the existing 5-second acquisition/connect, 8-second server statement,
10-second client query/idle/idle-transaction and 60-second connection-lifetime
limits. The database wrapper discards failed clients and returns safe errors;
there is no transparent transaction replay to add here.

Transaction pooling is desirable for web runtime where compatible, and these
application transactions do not intrinsically require session advisory locks.
However pg 8.23.1 sends statement_timeout and idle_in_transaction_session_timeout
as startup parameters. The unchanged client is incompatible with Neon's documented
pooled startup-parameter allowlist. The minimum-change prepared mapping therefore
uses the existing direct hostname initially, preserving TLS and enforced timeouts.
A later pooled configuration needs a reviewed way to preserve those policies and
exact-driver validation; do not silently delete the protections or claim pooled
compatibility. Migrations use session advisory locking and backups use libpq
tools, so retain direct operator connections.
[Neon startup-parameter restrictions](https://neon.com/docs/connect/connection-errors#unsupported-startup-parameter),
[Neon pooling guidance](https://neon.com/docs/connect/connection-pooling).

### Local rehearsal and future approval

Run npm run test:staging-app-role with an explicit exclusive disposable PostgreSQL
18.6 loopback cluster and PG_BIN pointing to its PostgreSQL 18 tools. Require SCRAM
for the fixed app/six-role identities; legacy synthetic fixture roles retain their
existing isolated loopback trust. This test executes the exact proposed SQL,
exercises real application handlers with one identity, verifies negative SQL
permissions, and compares all six local analogues' credential verifiers, attributes,
memberships, settings and effective grants before/after. No .env.local or hosted
credentials are loaded. Existing backups and fixtures remain separate.
All ten consolidated-role tests passed on disposable PostgreSQL18.6, including
actual SCRAM logins through all four pools, exact effective grants across 38 tables
and 419 columns, negative SQL permissions, real mocked application workflows,
and preservation of the six prior local identities. Lint, TypeScript and the
production build passed from a credential-free source snapshot. No application
source, homepage asset, migration, old role artifact or existing test was changed.
The full 250-test non-browser suite passed on a second disposable PostgreSQL18.6
cluster: 232 existing regressions, eight existing per-role checks and ten new
consolidated-role checks. Both clusters reported zero leftover fixture databases
or roles before cleanup. Hosted Neon was not contacted during this preparation.

Before any hosted CREATE ROLE, ALTER ROLE, GRANT or REVOKE, obtain explicit approval
for the final pinned app-role SQL. Later reconfirm the exact project/branch/compute
Console mapping, host/database/owner, PostgreSQL18.6 primary, verify-full TLS and
required channel binding, ledger/checksums and schema baseline. Generate a separate
strong random app credential and verify encrypted recoverable custody outside the
repository, without changing the six-role bundle. Run the app artifact once with
psql18 -X and ON_ERROR_STOP through a protected launcher; never rerun the earlier
six-role provisioning SQL. The exact PHASE11F_TARGET_APPROVED marker includes
green-glitter-95493455/br-rough-term-b9hae0t4/ep-wispy-feather-b95dea30/la_palme_dor_staging/lapalme_staging_app.
The marker does not prove cloud identity.

Any guard/error before COMMIT rolls back new-role creation and grants; a lost
connection at COMMIT requires inspection, not blind repetition. Hosted verification
and integration remain separate approved actions. No new app credential is
generated or stored by this preparation; only disposable synthetic credentials
are used locally. No Cloud Run, Secret Manager, Docker image, safety gate or live
payment change is authorized by this proposal.

### Approved staging app-role provisioning (2026-10-30)

The operator explicitly approved lapalme_staging_app and the exact SHA-256 above.
Fresh read-only checks confirmed the direct staging endpoint/database, PostgreSQL
18.6 writable primary, verify-full TLS 1.3 and required channel binding, twelve
pinned ledger records, expected schema counts and 37 empty business tables.
An initial local checker argument error was corrected before any hosted mutation;
all actual preflight checks passed before execution.

An independent random 32-byte app password was retained in a new operator-only
Windows DPAPI CurrentUser bundle outside the repository. The six-role credential
bundle was not decrypted or changed. Credential recovery passed before execution
and again in a fresh process after verification. The approved SQL ran exactly once
and COMMIT was confirmed; only lapalme_staging_app was provisioned.

Hosted verification through the actual app LOGIN passed all 304 table, 1,676
column and 1,980 grant-option checks against the independently tested contract.
Administrative attributes/memberships, ownership and persistent CREATE were
absent. All 118 allowed zero-row read/write checks passed with ROLLBACK, including
INSERT checks that excluded PostgreSQL-generated columns. No business rows were
created. All 27 negative native-SQL probes returned the expected SQLSTATE 42501:
schema/table changes, role creation/escalation, ledger access/modification,
unrelated objects and protected credential/financial/audit/history operations
were denied. Each probe used a savepoint and captured its own primary message
and SQLSTATE; no procedural DO wrapper or inference from XX000 was used.

The final owner inspection matched the six existing identities' attributes,
memberships, settings and table/column/schema/database grants to the preflight
snapshot. The original encrypted credential files remained byte-identical.
All twelve complete ledger records and checksums were unchanged. Schema counts
remained 38 tables, 419 columns, 169 indexes, 38 primary keys, 44 unique constraints,
62 foreign keys, 224 checks and 278 NOT NULL constraints, with no invalid indexes
or unenforced/unvalidated constraints. All 37 business tables remained empty.

The previously passing 250 local tests and lint/TypeScript/build results apply to
unchanged application/test/migration source. This provisioning changed no runtime
code or safety gate. No Cloud Run, Google Secret Manager, live payment, production
branch, customer/inventory/order/payment record, commit, push or deployment action
occurred. Task-local verifier containers and scratch were removed; only encrypted
operator credential custody and its non-printing import helper were retained.
App-role provisioning and verification PASS, with no remaining blocker in this
task. Cloud integration remains a separate authorization. The earlier six-role
XX000 verification history is preserved without reinterpretation.


## Phase 11F-B: Cloud Run to Neon connection preparation (2026-10-30)

Historical preparation record below. The controlled Step A completion and Step B
hold at the end of this document supersede the unexecuted procedures here:
do not recreate/upload the database secret or run the earlier DB-only service
update. The latest approval requires auth/origin preparation before any update.

**Preparation only; no cloud secret, IAM, API or service mutation was executed.**
The existing service was inspected read-only in project la-palme-dor-513011
(number 567666466240), region europe-west1. It is Ready on
la-palme-dor-staging-00002-8dt, generation 2, with 100% traffic to that revision.
The runtime account is
la-palme-d-or-runtime@la-palme-dor-513011.iam.gserviceaccount.com.
No public invoker binding or direct project-level runtime IAM role was present.
IAM authentication remains enabled by default; ingress is currently all and
must be preserved. Limits are 1000m CPU, 1Gi RAM, min instances 0 (default),
service max instances 2, concurrency 4, port 8080 and request timeout 60s.
Existing startup CPU boost is true; leave it unchanged.

The service's configured image reference ends in 8eca92e0...dd3e7f, while the
ready revision resolves to the exact image below. The proposed update pins the
running revision's resolved digest, preserving deployed content rather than
assuming the older configured reference is the leaf manifest:

    europe-west1-docker.pkg.dev/la-palme-dor-513011/la-palme-dor/la-palme-dor-staging@sha256:bf592792f6f50ce37a6a5360ecbeb404cb82da258783101b7913a9058ae5b74e

The current revision has no explicit environment entries. The existing local v2
image's public runtime ENV contains NODE_ENV=production, HOSTNAME=0.0.0.0,
PORT=8080 and NEXT_TELEMETRY_DISABLED=1; no database credential is baked into it.
Payment, reconciliation and checkout-retention gates remain disabled through
their existing fail-closed defaults. No image rebuild is required.

### Connection validation and required timeout configuration

The existing non-printing DPAPI import was used without changing its bundle.
A connection URL was assembled only in process memory for lapalme_staging_app,
the exact direct staging host, port 5432 and la_palme_dor_staging, using
sslmode=verify-full and channel_binding=require. No owner credential was used.
The actual pg 8.23.1 driver authenticated as this restricted identity against
PostgreSQL18.6, with an authorized TLS1.3 stream and rejectUnauthorized=true.
Channel binding is enabled by pg; its flag is not the strict libpq require
guarantee. Real catalogue repository queries and a read-only cart-pool query
succeeded and returned empty results. Products, carts, orders and payments remained
empty; the app still cannot SELECT the migration ledger.

A new runtime compatibility finding must not be hidden: the driver's individual
startup fields requested statement_timeout=8000 and
idle_in_transaction_session_timeout=10000, but fresh direct Neon sessions reported
0 and 5min. A process-local PGOPTIONS setting was tested without persistent changes:

    -c statement_timeout=8000 -c idle_in_transaction_session_timeout=10000

Fresh actual-driver sessions then reported 8s/10s. A read-only pg_sleep query was
cancelled by the server with SQLSTATE57014 under the 8s policy. The prepared
Cloud Run update therefore includes this exact non-secret PGOPTIONS value.
Do not silently drop the limits or claim the old individual startup fields alone
enforce them on this endpoint. The unchanged driver reads PGOPTIONS as its options
fallback; all three newly created runtime pools receive the setting. Keep the
direct endpoint; transaction-pool compatibility with these options is not established.
[Neon upstream startup-parameter issue](https://github.com/neondatabase/neon/issues/12856),
[Neon startup restrictions](https://neon.com/docs/connect/connection-errors#unsupported-startup-parameter).

### Secret, IAM and runtime mapping

Secret Manager's API is currently DISABLED. It was not enabled and secret
existence/version metadata was not queried through the disabled API. Do not
assume the proposed name is absent or its first usable version will be 1.

| Configuration | Prepared value |
| --- | --- |
| Secret | la-palme-dor-staging-db, one restricted application URL |
| DATABASE_URL | Secret reference la-palme-dor-staging-db:N |
| ADMIN_DATABASE_URL | Same secret and exact numeric version N |
| CART_DATABASE_URL | Same secret and exact numeric version N |
| PGOPTIONS | Non-secret timeout value shown above |
| PAYMENT_DATABASE_URL | Remain absent |
| Backup/migration credentials | Remain outside Cloud Run |

Use the positive numeric version returned by the upload, never latest or an
unpinned alias. Grant roles/secretmanager.secretAccessor only on this secret to
the exact runtime account above. Do not add project-level accessor grants or
service-account keys. The operator needs API-enable, secret-create/version-add/
secret-policy-update, Cloud Run update and service-account actAs permissions;
do not grant those administrative capabilities to the runtime account.

The three lazy application pools retain their existing max4 caps: at most
12 connections per instance, 24 across two instances, plus operator/task and
rollout headroom. PAYMENT_DATABASE_URL stays absent and its pool unused. Preserve
connect/acquisition 5s, query/idle 10s and lifetime60s; no pool or retry is added.

### Exact future operator procedure — approval required

The following commands are a reviewable plan, not authorization to execute.
Recheck the current service generation/revision, resolved digest, runtime account,
resources, IAM restriction, environment and safety defaults first; stop on drift.
The old generic prepare-staging.mts utility rejects this actual service/secret
naming and is not used to replace the service. Use only the additive update below.

~~~powershell
$Project = 'la-palme-dor-513011'
$Service = 'la-palme-dor-staging'
$Region = 'europe-west1'
$SecretName = 'la-palme-dor-staging-db'
$RuntimeAccount = 'la-palme-d-or-runtime@la-palme-dor-513011.iam.gserviceaccount.com'
$Image = 'europe-west1-docker.pkg.dev/la-palme-dor-513011/la-palme-dor/la-palme-dor-staging@sha256:bf592792f6f50ce37a6a5360ecbeb404cb82da258783101b7913a9058ae5b74e'

# READ-ONLY: compare with the reviewed baseline; capture/redact full config internally.
gcloud.cmd run services describe $Service --project=$Project --region=$Region --format='value(status.latestReadyRevisionName)'
gcloud.cmd run revisions describe la-palme-dor-staging-00002-8dt --project=$Project --region=$Region --format='value(status.imageDigest)'

# MUTATES project API configuration; separate approval required.
gcloud.cmd services enable secretmanager.googleapis.com --project=$Project

# READ-ONLY after API enable. If it exists, STOP and inspect; do not overwrite/reuse blindly.
gcloud.cmd secrets describe $SecretName --project=$Project --format='value(name)'
# Only an explicit NOT_FOUND permits the approved creation step.
# MUTATES Secret Manager.
gcloud.cmd secrets create $SecretName --project=$Project --replication-policy=automatic
~~~

Upload from the existing encrypted custody with redirected raw stdin. Do not
replace this with Write-Output piping, which can append a newline. No password
or complete URL belongs in argv, an ordinary Cloud Run env value, a repository
file or console/log output. This block is also MUTATING and remains unexecuted:

~~~powershell
$ErrorActionPreference = 'Stop'
. 'C:\Users\Mahitab\.pg-secure\la-palme-dor-staging-app-20261030-ae23c65f\Import-StagingAppCredential.ps1'
$bundle = $null
Import-StagingAppCredential -Destination ([ref]$bundle)
if ($bundle.credential.role -ne 'lapalme_staging_app') { throw 'Restricted identity guard failed.' }

$uri = [UriBuilder]::new()
$uri.Scheme = 'postgresql'
$uri.Host = $bundle.target.host
$uri.Port = 5432
$uri.Path = '/la_palme_dor_staging'
$uri.UserName = $bundle.credential.role
$uri.Password = $bundle.credential.password
$uri.Query = 'sslmode=verify-full&channel_binding=require'
$payload = [Text.Encoding]::UTF8.GetBytes($uri.Uri.AbsoluteUri)

$sdk = 'C:\Users\Mahitab\AppData\Local\Google\Cloud SDK\google-cloud-sdk'
$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = Join-Path $sdk 'platform\bundledpython\python.exe'
$start.Arguments = '"' + (Join-Path $sdk 'lib\gcloud.py') + '" secrets versions add la-palme-dor-staging-db --project=la-palme-dor-513011 --data-file=- --format=json --quiet --verbosity=error'
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.EnvironmentVariables['CLOUDSDK_CORE_DISABLE_PROMPTS'] = 'true'
$start.EnvironmentVariables['CLOUDSDK_CORE_DISABLE_FILE_LOGGING'] = 'true'
foreach ($name in @('CLOUDSDK_CORE_LOG_HTTP','CLOUDSDK_CORE_LOG_HTTP_SHOW_REQUEST_BODY','CLOUDSDK_CORE_LOG_HTTP_STREAMING_BODY')) {
  $start.EnvironmentVariables[$name] = 'false'
}
try {
  $process = [Diagnostics.Process]::Start($start)
  $outputTask = $process.StandardOutput.ReadToEndAsync()
  $errorTask = $process.StandardError.ReadToEndAsync()
  $process.StandardInput.BaseStream.Write($payload, 0, $payload.Length)
  $process.StandardInput.Close()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw 'Version upload failed or is uncertain. Stop; inspect version metadata without automatically retrying.'
  }
  $metadata = $outputTask.Result | ConvertFrom-Json
  if ($metadata.name -notmatch '^projects/(567666466240|la-palme-dor-513011)/secrets/la-palme-dor-staging-db/versions/([1-9][0-9]*)$' -or $metadata.state -ne 'ENABLED') {
    throw 'Version metadata guard failed. Stop without retry.'
  }
  $version = $Matches[2]
  # Only public version metadata may be displayed.
  Write-Output ('Pinned secret version: ' + $version)
} finally {
  [Array]::Clear($payload, 0, $payload.Length)
  $uri.Password = ''
  $bundle = $null
}
~~~

After successful upload and numeric version validation:

~~~powershell
# MUTATES only the named secret's IAM policy.
gcloud.cmd secrets add-iam-policy-binding $SecretName --project=$Project --member="serviceAccount:$RuntimeAccount" --role=roles/secretmanager.secretAccessor

$DbRefs = @(
  "DATABASE_URL=la-palme-dor-staging-db:$version"
  "ADMIN_DATABASE_URL=la-palme-dor-staging-db:$version"
  "CART_DATABASE_URL=la-palme-dor-staging-db:$version"
) -join ','

# MUTATES Cloud Run: creates a new revision, preserving the running image content.
# Current env is empty: no literal removal is required. Stop/review if it changes.
$UpdateArgs = @(
  'run', 'services', 'update', $Service
  "--project=$Project"
  "--region=$Region"
  "--image=$Image"
  "--update-secrets=$DbRefs"
  '--update-env-vars=PGOPTIONS=-c statement_timeout=8000 -c idle_in_transaction_session_timeout=10000'
)
# Historical DB-only draft, superseded by the final combined Step B block below.
# gcloud.cmd @UpdateArgs

# READ-ONLY metadata checks; also compare IAM/resources/env against the baseline.
gcloud.cmd run services describe $Service --project=$Project --region=$Region --format='value(status.latestReadyRevisionName,status.conditions)'
gcloud.cmd secrets get-iam-policy $SecretName --project=$Project
gcloud.cmd secrets versions describe $version --secret=$SecretName --project=$Project
~~~

Do not use set-secrets, set-env-vars, env-vars-file or clear flags: the additive
update must preserve unrelated settings. Do not pass ingress, unauthenticated,
service-account, CPU/memory, scaling or concurrency changes. If existing DB names
become literal env entries, stop and review a same-update remove-env-vars conversion;
do not create a separate intermediate revision without authorization.
[Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets),
[gcloud service update](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/update),
[stdin version upload](https://docs.cloud.google.com/sdk/gcloud/reference/secrets/versions/add).

A failed upload/deployment is not permission to blindly retry or destroy resources.
Inspect secret-version and revision metadata. The reviewed rollback option is a
traffic change to the original ready revision; it also requires operator approval:

    gcloud.cmd run services update-traffic la-palme-dor-staging --project=la-palme-dor-513011 --region=europe-west1 --to-revisions=la-palme-dor-staging-00002-8dt=100

Leave secret versions/access intact while any revision may still depend on them.

### Verification limits and remaining setup

After a separately approved update, verify new-revision readiness, the exact image
digest, three identical numeric secret references, PGOPTIONS, resources, runtime
account and IAM restriction. Authenticate HTTP checks without printing identity
tokens. Verify homepage200, collections DB connectivity and the expected empty
catalogue, generic failures/no secret leakage, and compare log output safely in
memory rather than dumping payloads. Do not add a debug SQL endpoint.

Current CART_ORIGIN, BETTER_AUTH_URL and BETTER_AUTH_SECRET are absent from both
explicit service env and the image's runtime ENV. Adding only DB refs deliberately
preserves that state: admin auth fails closed, and cart writes require separate
exact-origin configuration. No initial administrator is provisioned. A no-cookie
GET cart response is not DB proof; the local read-only cart-pool query is the
available connection evidence here. End-to-end cart mutations/auth login need
their prerequisites and separate fixture approval.

There are no hosted products, so published retrieval and draft/archive privacy
cannot be demonstrated with hosted rows in this phase. Existing local fixture
tests remain evidence; defer hosted row-dependent assertions until approved
synthetic fixtures exist. Never enable PAYMENT_DATABASE_URL, Paymob, reconciliation
or CHECKOUT_DRAFT_RETENTION_READY to make a smoke test pass.

Three targeted staging secret/configuration tests passed. Three offline tests
also passed against the installed Google Cloud SDK's real
Service/config_changes classes: the exact secret and numeric fixture version7
were mapped to all three variables, preserved service/env/resource metadata,
and correctly handled or rejected literal-to-secret conversion. Network calls
and credential access were forbidden during these SDK tests.
Actual-driver validation
also passed URL/TLS guards, same-credential mapping, catalogue repository/cart SQL,
server SHOW8s/10s and server-side timeout cancellation. No application code changed,
so the conditional lint/TypeScript/build rerun was unnecessary. No cloud resource,
IAM policy, revision, API, secret or database role was changed by preparation.
All three prepared PowerShell blocks passed syntax parsing. Numeric-version
capture and a real redirected-stdin fixture verified byte-exact UTF-8 delivery
without a BOM or newline. The final read-only Cloud Run/IAM/API snapshot matched
the initial revision, image, environment, runtime account and disabled API state.


### Phase 11F-B controlled Step A completion and Step B hold (2026-10-30)

**Step A PASS. Step B remains preparation only; Cloud Run was not updated.**
The operator approved API enablement, exactly one database secret/version and
one secret-scoped runtime accessor binding. These actions completed once:

| Verified item | Result |
| --- | --- |
| Project | la-palme-dor-513011 / 567666466240 |
| Secret Manager API | ENABLED |
| Created secret | la-palme-dor-staging-db |
| Pinned numeric database version | 1, ENABLED |
| Full version resource | projects/567666466240/secrets/la-palme-dor-staging-db/versions/1 |
| Upload integrity | Client-specified CRC32C accepted; private read-back matched every input byte |
| Secret policy | One roles/secretmanager.secretAccessor binding, only the runtime account below |
| Runtime principal | serviceAccount:la-palme-d-or-runtime@la-palme-dor-513011.iam.gserviceaccount.com |
| Project-level runtime IAM | Unchanged; no project-wide accessor grant |
| Additional secrets created | None |

The payload was constructed only in memory through the existing non-printing
DPAPI app-credential import. It contained only the verified restricted
lapalme_staging_app connection, never neondb_owner. Upload used raw UTF-8 stdin
with HTTP/body/file logging disabled. Verification accessed the exact numeric
version privately and compared decoded bytes without displaying the URL, password,
payload or hashes. Exactly one version was present. No credential file, service
account key or ordinary Cloud Run database env value was created.

Fresh actual-driver validation before upload confirmed app identity, exact staging
host/database, PostgreSQL18.6, authorized TLS1.3, SHOW8s/10s under the prepared
PGOPTIONS policy and denial of ledger reads. No Neon role, grant, schema,
migration or business record changed.

The final Cloud Run service specification and IAM policy matched the preflight
fingerprints. Generation2 and la-palme-dor-staging-00002-8dt remain current, with
the same resolved image digest, runtime identity, ingress, resources, scaling,
concurrency, traffic and safety defaults. A local null-array checker error was
corrected before any cloud mutation; all actual guards passed before execution.
The existing DPAPI bundle and import helper were retained unchanged.

#### Final combined service configuration (executed once in Step B2)

Use this one verified HTTPS origin for both server-side origin settings, without
a trailing slash:

    https://la-palme-dor-staging-4dedelrv2a-ew.a.run.app

The numbered run.app alias is a different browser origin. Use the chosen origin
consistently; do not add wildcard origins or weaken host-only/Secure cookies.
Changing these server-side origin settings does not rebuild static canonical
metadata, robots or headers; preserve the existing image and approved UI.

| Variable | Verified configured value |
| --- | --- |
| DATABASE_URL | Secret la-palme-dor-staging-db:1 |
| ADMIN_DATABASE_URL | Secret la-palme-dor-staging-db:1 |
| CART_DATABASE_URL | Secret la-palme-dor-staging-db:1 |
| CART_ORIGIN | Exact HTTPS origin above |
| BETTER_AUTH_URL | Same exact HTTPS origin |
| BETTER_AUTH_SECRET | Secret la-palme-dor-staging-auth:1 |
| PGOPTIONS | -c statement_timeout=8000 -c idle_in_transaction_session_timeout=10000 |
| PAYMENT_DATABASE_URL | Remain absent |
| Payment initiation/reconciliation and draft-retention readiness | Remain disabled; no safety flag is enabled |

At Step A completion the auth secret was absent. The separately approved Step B1
below created and verified la-palme-dor-staging-auth version1 with independent
random signing material, recoverable operator-controlled DPAPI custody and only
the approved secret-scoped runtime accessor. Never reuse the database password,
persist plaintext auth values, or put BETTER_AUTH_SECRET in ordinary Cloud Run
env configuration.

The single additive update below uses both verified numeric versions. It was
executed once under the separate Step B2 authorization recorded below. Its
invocation remains commented to prevent accidental re-execution.

~~~powershell
$DbVersion = '1'
$AuthVersion = '1'
$Origin = 'https://la-palme-dor-staging-4dedelrv2a-ew.a.run.app'
$Image = 'europe-west1-docker.pkg.dev/la-palme-dor-513011/la-palme-dor/la-palme-dor-staging@sha256:bf592792f6f50ce37a6a5360ecbeb404cb82da258783101b7913a9058ae5b74e'
if ($DbVersion -ne '1' -or $AuthVersion -ne '1') { throw 'Reviewed numeric secret versions changed; stop.' }
$Refs = @(
  "DATABASE_URL=la-palme-dor-staging-db:$DbVersion"
  "ADMIN_DATABASE_URL=la-palme-dor-staging-db:$DbVersion"
  "CART_DATABASE_URL=la-palme-dor-staging-db:$DbVersion"
  "BETTER_AUTH_SECRET=la-palme-dor-staging-auth:$AuthVersion"
) -join ','
$ArgsForReview = @(
  'run', 'services', 'update', 'la-palme-dor-staging'
  '--project=la-palme-dor-513011'
  '--region=europe-west1'
  "--image=$Image"
  "--update-secrets=$Refs"
  "--update-env-vars=PGOPTIONS=-c statement_timeout=8000 -c idle_in_transaction_session_timeout=10000,CART_ORIGIN=$Origin,BETTER_AUTH_URL=$Origin"
)
# EXECUTED ONCE in Step B2. Historical command; do not rerun.
# gcloud.cmd @ArgsForReview
~~~

Recheck the service/revision/image/IAM/resource baseline immediately before that
future update and stop on drift. Do not rerun the completed database-secret
creation/upload procedure. No initial administrator or fixture data is created
by authentication configuration. Administrator provisioning and data-dependent
hosted tests still require their own approval. Nine offline source-configuration
assertions passed for exact production origins, auth validation, Secure host-only
cookies and unavailable payments. No application code or dependency changed.
The combined Step B block also passed PowerShell syntax and offline expansion:
all three database refs and the auth ref stayed pinned to1,
exact origin/timeout values matched, and forbidden payment/readiness/IAM
flags were absent. The cloud command was shadowed and remained commented, so
this test could not update a service. Task scratch was removed; DPAPI custody
and the approved database secret/version/IAM binding were retained.

### Phase 11F-B Step B1 authentication secret completion (2026-10-30)

**Step B1 PASS. The combined service update remains unexecuted.**

| Verified item | Result |
| --- | --- |
| Project | la-palme-dor-513011 / 567666466240 |
| Exactly one new secret | la-palme-dor-staging-auth |
| Pinned numeric version | 1, ENABLED; exactly one version present |
| Full version resource | projects/567666466240/secrets/la-palme-dor-staging-auth/versions/1 |
| Upload integrity | Client-specified CRC32C accepted; private numeric-version read-back matched every input byte |
| Secret-scoped IAM | Only roles/secretmanager.secretAccessor for serviceAccount:la-palme-d-or-runtime@la-palme-dor-513011.iam.gserviceaccount.com; no condition or additional binding |
| Credential custody | DPAPI CurrentUser; operator-only protected ACL; independent recovery verified |
| Cloud Run | Generation2 and la-palme-dor-staging-00002-8dt unchanged; service specification, annotations and IAM matched preflight |
| Existing database secret | Version1 metadata and IAM unchanged; no database credential read during Step B1 |
| Project-level runtime IAM | Unchanged; no project-wide grant |

The secret used 48 bytes from the platform cryptographic random generator, encoded
as 64 base64url characters. The real application's adminConfiguration accepted it
without printing it. Raw UTF-8 stdin upload used no BOM/newline, secret-bearing
arguments or plaintext files; SDK file/HTTP/body logging was disabled. Private
read-back decoded the numeric version and compared bytes in memory. A final fresh
process recovered the retained DPAPI bundle, rechecked its operator-only ACL and
repeated the pure source-configuration checks without network access. No secret
value or payload hash was displayed or saved in Git, logs or an image.

Retained operator-controlled custody, outside the repository:

    C:\Users\Mahitab\.pg-secure\la-palme-dor-staging-auth-20261030-5120ba89\auth-secret.dpapi
    C:\Users\Mahitab\.pg-secure\la-palme-dor-staging-auth-20261030-5120ba89\Import-StagingAuthenticationSecret.ps1

Recovery requires the same Windows account/profile. The importer returns the
verified bundle only through an explicit reference, without printing it:

~~~powershell
. 'C:\Users\Mahitab\.pg-secure\la-palme-dor-staging-auth-20261030-5120ba89\Import-StagingAuthenticationSecret.ps1'
$bundle = $null
Import-StagingAuthenticationSecret -Destination ([ref]$bundle)
# Do not display, serialize, log or pass $bundle.secret in command arguments.
# Use it only inside a reviewed non-printing consumer, then release the reference.
$bundle = $null
~~~

#### IAM proxy and browser origin compatibility

Browser pages loaded through http://127.0.0.1:8080 make relative same-origin
authentication and cart requests with that loopback Origin. After the prepared
HTTPS settings are applied, the application's admin and cart handlers compare
Origin to the exact approved HTTPS origin and reject that mismatch. Better Auth
also trusts only that HTTPS origin with Origin/CSRF checks enabled. Its admin
cookies and the production __Host cart cookie remain Secure and host-only; a
loopback browser cookie jar does not reproduce the real service's cookie scope.

The upstream cloud-run-proxy rewrites the upstream Host and adds IAM credentials,
but preserves Origin and cookies; it also rewrites matching absolute redirect
locations back to the local HTTP endpoint. This is source-based analysis, not a
captured live proxy request. No listener or GET /robots.txt response was reachable
on 127.0.0.1:8080 from this execution session. No proxy was started, stopped or
changed, and no hosted login/cart mutation was attempted.
[Cloud Run proxy source](https://github.com/GoogleCloudPlatform/cloud-run-proxy/blob/main/main.go).

Keep BETTER_AUTH_URL and CART_ORIGIN set to the approved HTTPS service origin.
Do not add loopback/wildcard trusted origins, rewrite Origin, disable CSRF checks,
relax cookie attributes or make the service public to accommodate this proxy.
Use the existing loopback proxy for read-only GET smoke checks only.

For representative authenticated browser testing, use an isolated Chromium
session at the actual approved HTTPS origin with a separately reviewed CDP Fetch
interceptor attached before navigation, without competing interception handlers.
Acquire a short-lived authorized operator IAM ID token privately;
inject X-Serverless-Authorization only into each paused request whose parsed
origin exactly equals the approved HTTPS origin. Recheck every redirect, block
unapproved origins, preserve browser-generated Origin/Sec-Fetch/cookies, retain
normal TLS verification, disable service workers and keep tokens/profile data
out of HARs, traces, logs and persistent storage. The IAM token is separate from
the server-side Better Auth signing secret. The principal still needs Cloud Run
Invoker access. No service/IAM/security change is needed for this approach.
[Cloud Run authentication header](https://docs.cloud.google.com/run/docs/authenticating/service-to-service).

Use per-request CDP Fetch.continueRequest header overrides: the protocol states
these overrides do not carry across redirects, which produce fresh paused
requests. A global header setting or redirect-propagating route override can
leak an IAM token to an unintended redirect destination. Review and validate the
interceptor against controlled redirects before using it; no browser harness was
created or run in Step B1.
[CDP Fetch protocol](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Fetch.pdl).

#### Remaining execution gates and cleanup

The combined configuration above is ready for separate Cloud Run update
authorization. Immediately before execution, recheck both pinned versions and
their scoped IAM, the current ready revision/image, origin, account, resource
limits, concurrency, scaling, ingress, traffic, IAM restriction and empty env
baseline. Stop on drift. Apply only the reviewed additive update; then verify
revision readiness and preserved settings before authenticated GET checks.
Do not rerun either completed secret creation/upload procedure.

Browser login requires a separately approved administrator, and row-dependent
tests require separately approved synthetic fixtures. These prerequisites were
not created. PAYMENT_DATABASE_URL remains absent; Paymob, reconciliation and
checkout retention readiness remain disabled. No Neon operation, service update,
application/UI change, image build, commit, push or deployment occurred.

Step B1 temporary execution scripts, sanitized receipts and snapshots were
removed after verification. The two new encrypted-custody/import files above
were retained; all prior credential bundles and existing application/migration
files were preserved. Only this existing operations document changed during
Step B1. Git stayed on master at 3ab5bf1d00f0aebdfac147dbb8c36e560cf2b782,
with the same 17 modified tracked entries and 21 untracked entries, nothing staged.

### Phase 11F-B Step B2 existing staging service connection (2026-10-30)

**Step B2 PASS. One configuration update completed; no image rebuild or rollback.**

| Verified item | Result |
| --- | --- |
| Target | la-palme-dor-513011 / la-palme-dor-staging / europe-west1 |
| Previous ready revision | la-palme-dor-staging-00002-8dt |
| Final ready revision | la-palme-dor-staging-00003-r89 |
| Final service generation | 3; observed generation current |
| Traffic | 100% to the new ready revision; latest-revision traffic policy preserved |
| Canonical auth/cart origin | https://la-palme-dor-staging-4dedelrv2a-ew.a.run.app |
| Runtime identity | la-palme-d-or-runtime@la-palme-dor-513011.iam.gserviceaccount.com |
| IAM / ingress | IAM checks enabled, no public invoker binding; ingress all preserved |
| Resources | CPU 1000m, memory 1Gi, concurrency 4, request timeout 60s, port 8080 |
| Scaling | Minimum 0 (default), service maximum 2 preserved |
| Startup CPU boost | true, preserved |
| Secret metadata / IAM | Both numeric version1 records ENABLED with accepted upload checksums; secret-scoped runtime accessor policies unchanged |
| ERROR log check | Zero matching entries for the new revision in the preceding 20 minutes, limit 20; no log payloads displayed |
| Actual billed cost | No billed-cost figures retrieved; existing capacity limits preserved |

The configured image previously referenced manifest digest 8eca92e0...dd3e7f;
the old ready revision resolved to the following image. The update pinned that
same resolved image, and the new ready revision resolved to exactly the same
digest. No build, image push, tag lookup or image-content change occurred:

    europe-west1-docker.pkg.dev/la-palme-dor-513011/la-palme-dor/la-palme-dor-staging@sha256:bf592792f6f50ce37a6a5360ecbeb404cb82da258783101b7913a9058ae5b74e

The four secret references and three ordinary variables in the combined table
above were the only application configuration changes. Both the service template
and concrete revision contained exactly those seven entries, with no literal
database/auth secret values and no latest-version aliases. All other template
specification fields and traffic policy matched the baseline after normalizing
only the approved image/env changes and generated revision name, client metadata,
operation ID and template nonce. Object keys were canonicalized before comparison.
Service/project IAM, security/resource annotations, labels, and both existing
secret version metadata/IAM policies matched the preflight snapshot.

#### Both HTTPS service URLs checked; one application origin

Control-plane run.googleapis.com/urls listed both the hashed URL above and:

    https://la-palme-dor-staging-567666466240.europe-west1.run.app

Before mutation, each URL returned 403 for a cookie-free unauthenticated
GET /robots.txt and 200 for the same GET authenticated with the operator's IAM
ID token. Normal certificate/hostname verification remained enabled. The service's
status.url was the previously approved hashed URL, so both BETTER_AUTH_URL and
CART_ORIGIN were set to that exact origin. After the update, the protected admin
redirect independently confirmed it. No Origin was guessed from browser headers,
proxy rewrites or DNS changes. The numbered alias remains a valid service URL but
is a distinct browser origin; use the hashed URL consistently for application
testing. No second trusted origin, wildcard, localhost exception or CSRF change
was introduced. Cloud Run documents both default URL forms.
[Cloud Run service URLs](https://docs.cloud.google.com/run/docs/triggering/https-request#service_url).

The checked public HTML had no rel=canonical links. B2 did not change SITE_URL,
static metadata or the image. The verified auth/cart origin is independent of
SEO metadata and does not require an application rebuild.

#### Hosted read-only verification

All authenticated checks used the verified HTTPS origin and a short-lived
operator IAM ID token held only in memory. The token was supplied privately
through stdin to the HTTP client, attached only to the fixed approved target
using X-Serverless-Authorization, and never written to an argument, file or log.
No application cookies were sent, redirects were not followed, normal TLS checks
stayed enabled, and no browser/local proxy was used.

| GET | Result |
| --- | --- |
| / | 200; expected homepage content |
| /collections | 200; successful empty published-catalogue text, no unavailable/fallback text |
| /admin/login | 200; configured administrator credentials form |
| /admin | 307 to https://la-palme-dor-staging-4dedelrv2a-ew.a.run.app/admin/login; no-store |
| /api/admin/catalogue/products | 401 with expected generic authorization message; no-store |
| /robots.txt without IAM token | 403 |

The catalogue rendering calls connection() and makes runtime SELECTs through
the catalogue repository; its successful empty state is connection evidence,
not just an HTTP200 fallback. The no-cookie admin GETs return before any session
update/audit path. No POST, real login, invalid-cookie test, signup, administrator
provisioning, synthetic fixture or business record creation occurred. Origin/CSRF
mutation behavior was preserved by configuration/source inspection; no hosted
mutation was used to test it.

Four temporary PowerShell files passed syntax parsing. Offline preservation
validation accepted the intended configuration and rejected eight unsafe variants:
CPU, secret version, origin, payment URL, IAM, image, request timeout and scaling.
Application code and dependencies did not change, so lint/TypeScript/build and
database regression suites were not rerun; the image was not rebuilt.

#### Completion, recovery and cleanup

The new revision became Ready on the first submitted update, so the authorized
traffic rollback was unnecessary. The previous ready revision remains available;
the documented traffic rollback command remains the recovery procedure, subject
to the applicable operator authorization. Neither revision nor secret version was
deleted. No secret was created, re-uploaded or rotated in B2.

PAYMENT_DATABASE_URL remains absent. Payment initiation (live and sandbox),
reconciliation, checkout retention readiness and automatic admin provisioning
remain disabled/absent. No production credentials were mounted. No Neon schema,
role, grant, migration or password changed. No service, DNS record or public IAM
grant was created, and no application source/UI file changed.

All task-created temporary execution scripts, metadata snapshots, receipts and
diagnostics were removed. No local test server, browser or container was started. Existing
DPAPI custody and all pre-existing work were retained. Only this existing
operations document changed in the repository. Final Git status matched the
initial 17 modified tracked entries and 21 untracked entries on master at
3ab5bf1d00f0aebdfac147dbb8c36e560cf2b782; nothing staged, committed or pushed.

No Step B2 blocker remains. Browser login and data-dependent tests remain outside
this task: they require separately approved administrator/fixture setup and the
reviewed real-HTTPS authenticated browser harness described in Step B1. Paymob
and checkout readiness remain inactive.

### Phase 11G staging functional verification preparation (2026-10-30)

**Preparation/local verification completed. Hosted functional readiness is
PARTIAL: administrator provisioning, category setup and media readiness need
separate operator decisions/authorization. No hosted operation was performed.**

The intended target remains project la-palme-dor-513011, service
la-palme-dor-staging, region europe-west1, revision 00003-r89, canonical origin
https://la-palme-dor-staging-4dedelrv2a-ew.a.run.app and Neon database
la_palme_dor_staging. These are the operator-provided/B2 context, not a new hosted
inspection during this local-only phase. Before later execution, repeat the
read-only revision/configuration/IAM checks and direct database identity checks.

Initial Git state: master at 3ab5bf1d00f0aebdfac147dbb8c36e560cf2b782,
17 modified tracked entries, 21 untracked entries, nothing staged. All 248 existing
nonignored source/asset files were fingerprinted, excluding local secret files.
Only this document is intentionally amended; two reusable test-source files are
added below. Existing application/UI, navigation, migrations/checksums, secrets
and pre-existing changes are preserved.

#### One administrator: prepared identity and privilege boundary

The operator supplied the actual email privately in this session, display name
La Palme d'Or Admin, human role CATALOGUE_MANAGER, staging only. Account creation
is explicitly not yet authorized. No account password was generated or requested
in chat. CATALOGUE_MANAGER provides admin:enter and catalogue:manage and suffices
for this test scope; OWNER/ADMIN is unnecessary.

The reviewed lapalme_staging_app role cannot provision administrators. It lacks
INSERT on admin_users and admin_auth_accounts; all six older runtime identities
also lack these grants. The existing provisionAdmin operation needs identity,
credential and SYSTEM/ADMIN_PROVISIONED audit inserts in one transaction. Runtime
grants must stay unchanged. A separately approved operator/provisioner connection
with the two missing creation privileges is required. Existing neondb_owner may
be used only with explicit one-off approval for this operation, outside Cloud Run;
the operation does not require adding administrative rights to the runtime role.
See db/tools/provision-admin.ts and infra/neon/staging-app-role.review.sql.

Proposed execution order, after that separate approval:

1. Use the existing protected operator credential procedure; keep the connection
   only in a short-lived process environment. Do not put an owner URL in argv,
   logs, browser configuration, Secret Manager runtime mounts or source files.
2. Reconfirm project green-glitter-95493455, branch staging/br-rough-term-b9hae0t4,
   compute ep-wispy-feather-b95dea30 and exact direct hostname
   ep-wispy-feather-b95dea30.c-7.eu-central-1.aws.neon.tech. Require database
   la_palme_dor_staging, expected approved provisioner identity, PostgreSQL 18.6,
   verified TLS, writable primary and all 12 ledger entries/checksums matching the
   immutable migrations/manifest. Stop on any drift. Check that the supplied
   email is absent before provisioning. Never use a pooled/production endpoint.
3. Set ADMIN_DATABASE_URL only in that guarded interactive operator process.
   Invoke the existing CLI directly, avoiding npm admin:provision's automatic
   .env.local loading. Set OperatorEmail to the session-supplied identity and
   OperatorName to the supplied display name; neither is a password:

~~~powershell
# FUTURE MUTATION ONLY AFTER EXPLICIT APPROVAL AND TARGET/LEDGER/TLS PREFLIGHT.
# ADMIN_DATABASE_URL must already contain the approved operator-only connection.
node.exe --experimental-strip-types --conditions=react-server scripts/provision-admin.mts `
  --email $OperatorEmail --name $OperatorName --role CATALOGUE_MANAGER `
  --confirm-admin-create --allow-remote-provisioning
~~~

4. Enter the independent password only at the existing hidden terminal prompt.
   Keep it in the operator's password manager, never argv, chat, .env.local,
   screenshots or logs. Existing validation requires 16–128 characters, at least
   eight distinct characters and no controls/common prefix/email-derived value.
   Do not pass existing-admin-id for this new identity.
5. Privately verify one matching identity, one credential account and one
   provisioning audit event, with no session created. Clear the temporary
   connection environment in finally. Do not print password hashes either.

The CLI hashes using installed Better Auth outside the transaction, locks
provisioning, rejects duplicates and commits identity/credential/audit atomically.
Its remote flag is consent, not an exact host/database allowlist; the separate
target preflight above is mandatory. On an uncertain COMMIT, inspect privately
and stop; do not automatically repeat the command or reset an existing identity.
No provisioning CLI or application change is required.

#### Minimal demonstration catalogue and remaining prerequisites

Use one product and state transitions rather than seeding a catalogue:

| Item | Proposed staging-only value |
| --- | --- |
| Category if none suitable exists | [STAGING DEMO] Demonstrations; slug staging-demo; visible root |
| Product | [STAGING DEMO] Earrings; slug staging-demo-earrings |
| Type / mode | REPEATABLE / DIRECT_PURCHASE |
| Variant | One active variant; SKU STAGING-DEMO-EARRINGS-01 |
| Initial price | EGP 100.00; explicitly illustrative, not a real offer |
| Test price change | EGP 125.50; verify current-price refresh and exact minor-unit totals |
| Stock | Two synthetic test units; adjustment reason explicitly says test data, not real stock |
| Description | Staging demonstration only. Not for sale; no verified stock, material, gemstone or authenticity claim. |
| Claims fields | Empty gemstone list; metal, origin, laboratory and certificate fields blank |
| Existing source photograph | public/images/ruby-earring-no-bg.png; describe the pictured earrings without inferring material from the filename |
| Photograph alt | Existing photograph of drop earrings for staging demonstration. |

Publication requires a visible category, active variant, EGP price, inventory row
and primary photograph with valid alt text. Empty gemstone lists are supported.
The existing admin UI cannot create categories, and the runtime role has SELECT
only on categories/collections. Migrations do not seed these reference records.
First inspect existing categories read-only; a new reference category requires
separate narrowly scoped operator data approval. No collection is needed. Do not
run the loopback-only development seed against Neon or broaden runtime grants.

If the new category is approved, the minimal reviewed data operation is one
INSERT after the same target/TLS/ledger preflight, in an explicit transaction:

~~~sql
-- REVIEW ONLY. No execution in Phase11G. Existing operator privileges required.
BEGIN;
INSERT INTO categories(slug,name,description,is_visible)
VALUES ('staging-demo','[STAGING DEMO] Demonstrations',
        'Synthetic staging demonstrations only; not a real offer.',true)
RETURNING id;
COMMIT;
~~~

Record its returned UUID privately for bounded cleanup. A duplicate/error or
uncertain COMMIT is a stop condition, not permission to upsert/retry automatically.
The snippet is not a standalone target guard; the preflight remains required.

The B2 service has no CLOUDINARY_* configuration. The existing upload UI requires
Cloudinary; it cannot associate a /images/... path directly. Recommended later
path: approve an isolated staging Cloudinary environment, secure secret-backed
configuration and upload/delivery/retirement of this one existing image through
the existing UI. That needs separate service/secret/provider authorization and
its own exact configuration review; none is authorized or performed here.
Alternatively, a separately reviewed static-image data association could avoid
provider setup but would not verify upload functionality. No direct-media insert
or upload-bypass artifact is supplied. Do not invent credentials or use real
client/provider assets to make the test pass.

After prerequisites and data-test approval: create draft in the admin UI, set
the one variant/price/test stock/category, upload and select the primary image,
publish, verify /collections and /jewels/staging-demo-earrings, change the test
price once, verify cart refresh, then unpublish and verify 404/draft privacy.
Use existing remove-photo, stock adjustment and archive actions for retirement;
do not add a website feature or fabricate a certificate/origin/financial record.

#### Prepared authenticated HTTPS browser transport

Browser plugin not available: cached Playwright 1.55.0 and Chromium were used for
local validation without installing dependencies. The existing admin-browser
fixture remains loopback-only: it creates/deletes fixtures, starts local servers,
loads provider mocks and uses a disposable self-signed certificate. Never point
it or the integration suites at staging.

The new reusable tests/helpers/staging-iam-browser.mts exports stagingIamBrowser.
It pins the approved canonical HTTPS origin, accepts only an in-memory short-lived
IAM token and performs no credential acquisition/navigation on import. It creates
a fresh nonpersistent browser context with normal TLS verification, blocked
service workers and disabled cache; inherited browser/protocol/key logging must
be disabled before the dedicated Node process loads Playwright.

Raw CDP Fetch interception is attached before navigation. Each paused request
is checked against the exact origin before adding X-Serverless-Authorization;
redirects are checked again. Host, browser Origin, Fetch Metadata and cookies
are preserved. A token-free process-wide CONNECT destination gate permits only
the approved host:443 and tunnels TLS unchanged; it also blocks uninstrumented
frames/workers/new targets. The browser address remains the real HTTPS origin.
Unexpected pages are closed. The token expiry closes the session; caller finally
must also close it. No IAM, Origin/CSRF, secure-cookie or website configuration
change is involved.
[Cloud Run header](https://docs.cloud.google.com/run/docs/authenticating/service-to-service),
[CDP per-request redirect behavior](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Fetch.pdl).

For later approved use, capture an existing authorized operator gcloud
auth print-identity-token privately using the established logging-disabled
ProcessStartInfo procedure. Send it through raw stdin to a clean Node process;
never use token command arguments, shell substitution, HTTP/body logging, a token
file or a browser-persistent profile. A user developer token does not require
new service-account impersonation or IAM grants. The helper checks token shape
and freshness only; Google still verifies authentication/Invoker permission.
First validate a fixed read-only canonical GET before any approved application
write. Better Auth's signing secret stays server-side and is never a browser token.

The consumer API after secure in-memory import is:

~~~typescript
// FUTURE APPROVED SESSION ONLY; not executed against staging in Phase11G.
const session = await stagingIamBrowser({ token });
try {
  await session.page.goto(STAGING_ORIGIN + '/admin/login');
  session.assertHealthy();
  // Only separately approved UI operations; password supplied privately in memory.
} catch {
  throw new Error('Staging browser verification failed; details withheld.');
} finally {
  await session.close();
}
~~~

Do not use context.request (it bypasses browser CDP), global headers, route header
overrides, HARs, tracing, screenshots of credentials, storage-state files or raw
console/request/error logs. Raw Playwright fill/password errors may include input
values: consumers must use static/redacted failure messages. For two guests use
two independent factory instances. Keep copied cookies/storage state in memory
only and compare secret-bearing values through static boolean assertions.

The helper's separate loopback fixture accepts only a fixed dummy token, never
operator credentials. Its six local tests proved header/Origin/cookie semantics,
same-origin 302/307 redirects, foreign redirects/images/iframes/popups receiving
zero requests, and process-wide browser egress denial even with page CDP disabled.
This is transport simulation; no real IAM token or hosted browser login was used.

#### Cart and security test checklist for a later approved session

1. In independent guests A/B, add the one published direct-purchase variant.
   Inspect cookie metadata only: __Host-la-palme-bag, Secure, HttpOnly, SameSite=Lax,
   Path=/, no Domain and 30-day expiry. Only its hash is stored in PostgreSQL.
2. Reload and recreate a browser instance with the cookie copied only in memory;
   verify persistence. Never print/store the cookie or hash. Keep A/B cookies separate.
3. Verify EGP 100.00 and then EGP 125.50 after the approved admin price change;
   quantity 2 totals EGP 251.00. Server price is authoritative; reject client price fields.
4. Reject fractional/zero/100 quantities and quantity 3 against stock 2. Existing
   local tests additionally cover 99-per-line, 50-line and one-of-a-kind limits,
   bespoke/enquiry/unpriced/inactive/draft eligibility and stale-revision 409s.
5. B must not read/update/remove A's item; verify product publication and private
   draft/unpublished visibility, generic denial and no session fixation. A catalogue
   manager must not obtain OWNER/ADMIN/order-operation permissions. Public signup
   remains disabled, and missing/wrong Origin/CSRF requests remain rejected.
6. Through an approved read-only operator/app connection, compare this demo
   variant's inventory.on_hand/reserved and reservation/order/payment counts
   immediately before/after the cart-only window: unchanged. Cart add never
   reserves stock. Keep planned admin stock adjustments outside that comparison.
7. Assert all cart responses are private, no-store, max-age=0 and Vary: Cookie.
   No-cookie GET is DB-free; a valid-cookie GET updates rate counters and therefore
   also requires hosted application-data approval. Login/logout/negative auth
   checks similarly create/change sessions, throttle rows or audit events.

The hosted consolidated app role intentionally has catalogue/admin capabilities
as well as cart access. Verify HTTP guest ownership without claiming a cart-only
SQL identity. No checkout/payment initiation, order/customer creation, payment
callback, retention flag or provider transaction is part of these checks.

#### Validation, cleanup and exact future approvals

Relevant existing local suites passed 86/86: admin.test.mts,
catalogue-admin.test.mts, cart.test.mts, database.test.mts and storefront.test.mts.
Existing browser suites passed 23/23: admin, catalogue-admin, cart and storefront.
New staging-iam-browser.test.mts passed 6/6; total 115 selected tests, no skipped or
failed cases. npm run lint, npx tsc --noEmit and npm run build passed. These are
local source/build checks; no Cloud Run image was rebuilt or deployed.

The local DB was the cached official PostgreSQL 18.6-bookworm image in one uniquely
labelled container, bound only to a random 127.0.0.1 port with disposable tmpfs data.
Existing Docker resources and the installed PostgreSQL 17 service were untouched.
Browser suites ran sequentially with disposable local TLS, mocked media and
synthetic UUID fixtures. The existing cart browser fixture enables retention
readiness only inside its disposable local server; no hosted gate changed and
no payment provider was invoked. TLS test exceptions remain confined to the old
local self-signed fixture; the new staging transport has no TLS exception.

Desktop/mobile homepage and mobile cart captures were inspected; existing browser
checks covered page identity, meaningful content, overlays, console health,
interactions and layouts. Application/assets remained byte-identical. No new
pixel-baseline comparison is claimed. Temporary captures, TLS files, logs,
scratch scripts/receipts and local fixture databases/container were removed;
the previous TypeScript build-info bytes were restored. Normal ignored Next build
output is retained. No temporary token was acquired. Only this document and the
two reusable browser helper/test source files are intentional repository changes.
Final source comparison confirmed all pre-existing application/assets/migrations
unchanged, with only this document amended. Final Git state remains master at
3ab5bf1d00f0aebdfac147dbb8c36e560cf2b782, with17 modified tracked entries and23
untracked entries (the two added test sources), nothing staged. All pre-existing
Docker container states and image tags/IDs matched the starting inventory after
the one task container was removed. Fixture database/role checks returned zero
leftovers before removal. All local test listener ports were clear.

Before hosted execution, request separate explicit approvals for:

1. Exactly the session-specified staging account as CATALOGUE_MANAGER, secure
   password custody, and one-off approved operator/provisioner credential use
   for the atomic existing CLI operation. Do not broaden runtime grants.
2. The single category data insert if needed, using separately approved operator
   privileges; no hosted seed, role/schema/migration change or broad cleanup.
3. An isolated media path: preferred existing Cloudinary upload with separately
   reviewed secrets/service configuration and one test-owned upload/delivery/
   deletion, or a separately reviewed static-image association. This is a current
   readiness blocker, not permission to configure a provider/service in Phase11G.
4. One bounded functional session: login/logout and bounded negative security
   requests (including session/rate/audit writes), one demo product/variant and
   price history, two synthetic units, one photo association, publication/price/
   unpublication actions, two independent guest carts/items/rate counters and the
   private read-only comparisons above. No real customer/order/payment records.
5. Bounded retirement: empty the two guest carts, log out, unpublish, remove only
   phase-owned media through existing operations, retire synthetic stock and
   archive the demo product; separately hide only the created category if needed.
   Preserve audit history. No DELETE/TRUNCATE sweep or destruction of user assets.

None of these hosted data/provider/configuration operations was authorized by
Phase11G preparation. Stop here. Hosted functional readiness remains PARTIAL
until prerequisites and the explicit scopes above are resolved.

### Phase 11G-A one staging catalogue administrator provisioned (2026-11-02)

**PASS. Exactly one enabled CATALOGUE_MANAGER was created and verified.**
The operator-approved email and display name La Palme d'Or Admin matched exactly.
No hosted login, session creation or other functional test was attempted.

| Verified item | Result |
| --- | --- |
| Neon project | green-glitter-95493455 |
| Branch | staging / br-rough-term-b9hae0t4 |
| Compute | ep-wispy-feather-b95dea30 |
| Exact direct host | ep-wispy-feather-b95dea30.c-7.eu-central-1.aws.neon.tech |
| Database / version | la_palme_dor_staging / PostgreSQL 18.6 (180006) |
| Operator connection | Existing protected neondb_owner connection; provisioning only through the unchanged CLI |
| Target evidence | Saved endpoint pin, authorized TLS connection, exact current_database/current_user and SQL-exposed neon.project_id/neon.branch_id matched |
| Client TLS | Certificate/hostname authorization true, TLS1.3; existing driver policy unchanged |
| Migration history | All 12 version/filename/checksum records matched immutable source and manifest before and after |
| Approved identity before execution | Absent |
| Approved identity afterward | Exactly one enabled CATALOGUE_MANAGER, expected Better Auth linkage and display name |
| Credential record | Exactly one credential-provider account for the new identity; no hash value selected or displayed |
| Audit | Exactly one SYSTEM / ADMIN_PROVISIONED event, correct target and metadata role=CATALOGUE_MANAGER, linkedExisting=false |
| Sessions | None created |

Fresh independent read-only post-verification confirmed exact total row deltas:
admin_users 0→1, admin_auth_accounts 0→1 and audit_events 0→1. Counts in every other
public application table were unchanged (38 tables inspected). No customer,
catalogue, cart, inventory, order or payment data was inserted or changed.
Only the catalogue-manager human-role count increased; OWNER/ADMIN counts did not.

The stored role permits admin:enter and catalogue:manage. Existing policy denies
operations:manage, administrators:manage and all order permissions for that role.
The shared lapalme_staging_app SQL identity retained its existing grants: no
administrative attributes, memberships, ownership, persistent CREATE, identity/
credential INSERT, credential rewrite, identity role/activation UPDATE or ledger
access. The intentional timestamp-only UPDATE grant was preserved. Full ordered
runtime-role/ACL/ownership snapshots matched before and after, including the six
older runtime identities. No grants, roles, schema objects or migrations changed.

The unchanged scripts/provision-admin.mts called the existing provisionAdmin,
preserving source validation, Better Auth hashing, transaction advisory lock,
duplicate protection and the atomic identity/credential/audit commit. Four earlier
terminal submissions exited without data changes; fresh inspection confirmed the
account remained absent before the final operator-entered attempt. There was one
successful account creation and no blind retry of an uncertain database write.

Terminal input and local wrapper/visibility issues were resolved without changing
the CLI. The final input used two empty native Windows masked fields and exact
confirmation. The operator chose the password; no default or generated password
was used. The dialog supplied it only through a private child process environment
to the CLI's already supported ADMIN_PROVISION_PASSWORD input, which the CLI
immediately removes. Source validation ran again before hashing/creation. No
plaintext password, connection string, hash or session token was written into
arguments, files, reports or raw diagnostic logs. Controls, private environment
entries and managed references were cleared/disposed after use. No claim of
secure zeroing of immutable managed strings is made. The chat-exposed candidate
was not used to create the account.

The actual client TLS socket was authorized and encrypted. pg_stat_ssl separately
reported ssl=false for the backend behind the managed Neon proxy; that observation
was retained and was not misrepresented as the client's TLS status. No TLS option
was disabled or weakened. See [Neon security](https://neon.com/docs/security/security-overview).

The existing tests/admin.test.mts suite passed 23/23 on a disposable PostgreSQL 18.6
loopback container, covering provisioning, protected CLI input, duplicates,
password hashing/strength, authorization and runtime provisioning denial. Only
local synthetic administrator fixtures were used. No hosted browser login or
authentication request was made. No application/CLI source changed, so no new
lint/TypeScript/build rerun was required for this operational phase.

Cloud Run remained on la-palme-dor-staging-00003-r89. Complete service configuration,
service IAM and both pinned secret metadata/access policies matched the initial
snapshot. No secret payload was accessed, owner credential mounted, public signup
enabled, authentication secret changed, or service/configuration/IAM updated.

Cleanup removed the task-owned local database container after fixture database/
role counts returned zero, and preserved the starting Docker inventory and cached
image. All task-created terminal/dialog processes, temporary code, metadata
snapshots, sanitized receipts and local logs were removed. Existing .env.local,
DPAPI bundles/import helpers, migrations, source and user files were preserved;
the original TypeScript build-info bytes were retained/restored.

Only this existing operations document changed in the repository. Initial/final
Git status remained master at 3ab5bf1d00f0aebdfac147dbb8c36e560cf2b782, with 17 modified
tracked entries and 23 untracked entries, nothing staged. No commit, push or deploy.
No Phase 11G-A blocker remains. Browser login, catalogue/reference data/media and
guest-cart execution still require their separate scoped approvals.

