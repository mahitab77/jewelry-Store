import "server-only";
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { databaseConfig } from "../db/config.ts";
import { customerConfiguration, CustomerError, type CustomerConfiguration } from "./config.ts";
import { customerMailer, type CustomerMailer } from "./email.ts";
import { createCustomerAuth } from "./auth.ts";
export function createCustomerRuntime(config: CustomerConfiguration, mailer: CustomerMailer) {
  const pool = new pg.Pool({ ...databaseConfig(config.databaseUrl), application_name: "la-palme-customer" });
  pool.on("error", () => console.error("An idle customer database connection was closed."));
  // Better Auth awaits but deliberately catches mail callback failures. Track
  // acknowledgement per async invocation so its success cannot misreport delivery.
  const delivery = new AsyncLocalStorage<{ delivered: boolean }>();
  const auth = createCustomerAuth(config, pool, async message => { await mailer(message); const receipt = delivery.getStore(); if (receipt) receipt.delivered = true; });
  return { config, pool, auth, async sendCode(email: string) {
    await delivery.run({ delivered: false }, async () => {
      await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" } });
      if (!delivery.getStore()?.delivered) {
        await pool.query("DELETE FROM customer_auth_verifications WHERE identifier=$1", ["sign-in-otp-" + email]);
        throw new CustomerError("We could not send your code. Please wait before trying again.");
      }
    });
  } };
}
export type CustomerRuntime = ReturnType<typeof createCustomerRuntime>;
const state = globalThis as typeof globalThis & { laPalmeCustomerRuntime?: CustomerRuntime };
export function getCustomerRuntime(): CustomerRuntime {
  return state.laPalmeCustomerRuntime ??= createCustomerRuntime(customerConfiguration(), customerMailer());
}
