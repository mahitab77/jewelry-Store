import { adminConfiguration } from "../../src/lib/admin/config.ts";
import { createAdminRuntime } from "../../src/lib/admin/runtime.ts";
import { handleAdminAuth } from "../../src/lib/admin/http.ts";

const runtime = createAdminRuntime(adminConfiguration());
try {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const body = JSON.parse(input) as { email: string; password: string };
  const statuses = await Promise.all(Array.from({ length: 4 }, async () => (await handleAdminAuth(
    new Request(`${runtime.config.baseURL}/api/admin-auth/sign-in/email`, { method: "POST", headers: { Origin: runtime.config.baseURL, "Content-Type": "application/json" }, body: JSON.stringify(body) }), runtime)).status));
  process.stdout.write(JSON.stringify(statuses));
} catch { process.stderr.write("Disposable authentication worker failed."); process.exitCode = 1; }
finally { await runtime.pool.end(); }
