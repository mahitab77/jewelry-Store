import pg from "pg";
import { emitKeypressEvents } from "node:readline";
import { databaseConfig, isLoopback } from "../src/lib/db/config.ts";
import { provisionAdmin, AdminProvisioningError } from "../db/tools/provision-admin.ts";
import { isAdminRole } from "../src/lib/admin/policy.ts";

async function protectedPassword(): Promise<string> {
  const supplied = process.env.ADMIN_PROVISION_PASSWORD;
  delete process.env.ADMIN_PROVISION_PASSWORD;
  if (supplied) return supplied;
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new AdminProvisioningError("Use protected terminal input or ADMIN_PROVISION_PASSWORD; never a command-line password.");
  process.stdout.write("New administrator password (hidden): ");
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let password = "";
    const done = () => {
      process.stdin.removeListener("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onKey = (text: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") { done(); reject(new AdminProvisioningError("Provisioning cancelled.")); }
      else if (key.name === "return") { done(); resolve(password); }
      else if (key.name === "backspace") password = password.slice(0, -1);
      else if (text && !key.ctrl) password += text;
    };
    process.stdin.on("keypress", onKey);
  });
}

let pool: pg.Pool | undefined;
try {
  const args = process.argv.slice(2);
  const flags = new Map<string, string>();
  let confirmed = false;
  let remote = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--confirm-admin-create") confirmed = true;
    else if (args[i] === "--allow-remote-provisioning") remote = true;
    else if (["--email", "--name", "--role", "--existing-admin-id"].includes(args[i]) && args[i + 1] && !flags.has(args[i])) flags.set(args[i], args[++i]);
    else throw new AdminProvisioningError("Unsupported or duplicate provisioning arguments. Passwords must never appear in arguments.");
  }
  const role = flags.get("--role");
  if (!confirmed || !isAdminRole(role) || !flags.get("--email") || !flags.get("--name")) {
    throw new AdminProvisioningError("Specify --email, --name, --role OWNER|ADMIN|CATALOGUE_MANAGER and --confirm-admin-create.");
  }
  const config = databaseConfig(process.env.ADMIN_DATABASE_URL);
  if (!isLoopback(config.host ?? "") && !remote) throw new AdminProvisioningError("Remote provisioning requires deliberate --allow-remote-provisioning after schema and operator review.");
  const password = await protectedPassword();
  pool = new pg.Pool({ ...config, max: 1, application_name: "la-palme-admin-provisioning" });
  await provisionAdmin(pool, { email: flags.get("--email")!, displayName: flags.get("--name")!, role, password, existingAdminId: flags.get("--existing-admin-id") });
  console.log("Administrator provisioned and audited. No session was created.");
} catch (error) {
  console.error(error instanceof AdminProvisioningError ? error.message : "Administrator provisioning is unavailable. Check the operator connection and applied migrations.");
  process.exitCode = 1;
} finally { if (pool) await pool.end(); }
