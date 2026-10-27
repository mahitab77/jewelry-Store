import { purgeCheckoutDrafts } from "../src/lib/checkout/repository.ts";
import { closeDatabase } from "../src/lib/db/client.ts";

// Schedule at least hourly before enabling persistent drafts in production.
// Bounded batches, only expired/inactive draft PII; no cart or financial deletion.
try {
  let deleted = 0;
  for (let batch = 0; batch < 20; batch++) { const count = await purgeCheckoutDrafts(500); deleted += count; if (count < 500) break; }
  console.log(`Checkout retention: ${deleted} expired or inactive draft(s) deleted.`);
} catch { console.error("Checkout draft retention failed. Check database availability and the documented grants."); process.exitCode = 1; }
finally { await closeDatabase(); }
