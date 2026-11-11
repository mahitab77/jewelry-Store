// Only public selection context belongs in return URLs. Never accept a raw
// callback destination from the authentication library or include form input.
export function customerReturn(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000 || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value)) return "/account";
  try {
    const url = new URL(value, "https://intent.invalid");
    if (url.origin !== "https://intent.invalid" || url.hash || !["/account", "/contact", "/appointment"].includes(url.pathname)) return "/account";
    if (url.pathname === "/account") return url.search ? "/account" : url.pathname;
    const allowed = ["intent", "product", "variant", "channel"];
    if ([...url.searchParams.keys()].some(k => !allowed.includes(k)) || allowed.some(k => url.searchParams.getAll(k).length > 1)) return "/account";
    const intent = url.searchParams.get("intent"), product = url.searchParams.get("product"), variant = url.searchParams.get("variant"), channel = url.searchParams.get("channel");
    if (intent && !["QUOTATION", "MODIFICATION", "BESPOKE", "CONSULTATION"].includes(intent) || product && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product) ||
      variant && !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(variant) || variant && !product || channel && !["ZOOM", "BOUTIQUE"].includes(channel) ||
      url.pathname === "/appointment" && intent && intent !== "CONSULTATION" || channel && intent !== "CONSULTATION" || intent === "BESPOKE" && product || ["QUOTATION", "MODIFICATION"].includes(intent ?? "") && !product) return "/account";
    return url.pathname + url.search;
  } catch { return "/account"; }
}
export const customerSignIn = (destination: string) => `/account/sign-in?${new URLSearchParams({ returnTo: customerReturn(destination) })}`;
