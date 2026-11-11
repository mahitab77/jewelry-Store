import "server-only";
import { CustomerError } from "./config.ts";
export type CustomerMailer = (message: { email: string; otp: string }) => Promise<void>;
// Real sending is disabled unless a sender and a dedicated credential are approved.
// Tests inject an in-memory sink; there is no test/debug email endpoint.
export function customerMailer(env = process.env, send: typeof fetch = fetch): CustomerMailer {
  if (env.CUSTOMER_EMAIL_APPROVED !== "true" || !env.CUSTOMER_EMAIL_API_KEY ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.CUSTOMER_EMAIL_FROM ?? "")) throw new CustomerError("Customer sign-in is not available until email delivery is ready.");
  return async ({ email, otp }) => {
    try {
      const response = await send("https://api.resend.com/emails", { method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${env.CUSTOMER_EMAIL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.CUSTOMER_EMAIL_FROM, to: [email], subject: "Your La Palme d'Or sign-in code",
          text: `Your sign-in code is ${otp}. It expires in five minutes. If you did not request this code, ignore this email.` }) });
      if (!response.ok || typeof (await response.json() as { id?: unknown }).id !== "string") throw new Error();
    } catch { throw new CustomerError("We could not send your code. Please wait before trying again."); }
  };
}
