// Explicit Node preload for disposable browser fixtures. Excluded from release
// images and never imported by application code. Codes travel through IPC only.
if (process.env.CUSTOMER_BROWSER_PRELOAD === "1") {
  const target = new URL(process.env.CUSTOMER_DATABASE_URL!);
  if (target.hostname !== "127.0.0.1" || !/^\/lapalme_test_[a-z0-9_]+$/.test(target.pathname) || !process.send) throw Error("Customer mail mock requires an isolated local IPC fixture.");
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.resend.com") return original(input, init);
    const body = JSON.parse(String(init?.body)), otp = /\b\d{8}\b/.exec(body.text)?.[0];
    if (!otp || !Array.isArray(body.to) || !body.to[0].endsWith("@boutique.test")) throw Error("Invalid local mail fixture.");
    process.send!({ type: "customer-code", email: body.to[0], otp });
    return Response.json({ id: "local-in-memory-email" });
  };
}
