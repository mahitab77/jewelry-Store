import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import sharp from "sharp";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
// The same native-control checks now run after verified customer authentication.
const h=adminBrowserHarness(true,false,false,false,{requests:true});
const {origin}=h;
let browser: ReturnType<typeof h.current>["browser"];
beforeEach(()=>{browser=h.current().browser;});
type Page=Awaited<ReturnType<typeof browser.newPage>>;
async function signature(page: Page, name: string) {
  return page.locator(`[name="${name}"]`).evaluate((input: HTMLElement) => {
    const s = getComputedStyle(input), b = input.getBoundingClientRect();
    return { color: s.color, background: s.backgroundColor, border: s.border, padding: s.padding, font: s.font, colorScheme: s.colorScheme, height: b.height, outline: s.outline, outlineOffset: s.outlineOffset };
  });
}

async function iconContrast(page: Page, type: "date" | "time", width: number, channel: string) {
  const input = page.locator(`input[type="${type}"]`);
  await input.scrollIntoViewIfNeeded();
  const metrics = await input.evaluate((element: HTMLInputElement) => {
    const s = getComputedStyle(element);
    return { padding: parseFloat(s.paddingRight), border: parseFloat(s.borderRightWidth), background: s.backgroundColor };
  });
  const png = await input.screenshot({ animations: "disabled", caret: "hide", timeout: 15000 });
  const image = sharp(png), size = await image.metadata(); assert.ok(size.width && size.height);
  // Chromium does not expose reliable shadow-indicator geometry through
  // getComputedStyle(pseudo). Inspect the trailing 24px affordance region,
  // excluding the authored border/padding and the value at the opposite edge.
  const iconWidth = 24, iconHeight = 24;
  const raw = await image.extract({ left: Math.round(size.width - metrics.border - metrics.padding - iconWidth), top: Math.floor((size.height - iconHeight) / 2), width: iconWidth, height: iconHeight }).ensureAlpha().raw().toBuffer();
  const luminance = (r: number, g: number, b: number) => [r, g, b].map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const background = luminance(9, 8, 7); let visiblePixels = 0, peakContrast = 1;
  for (let i = 0; i < raw.length; i += 4) { const l = luminance(raw[i], raw[i + 1], raw[i + 2]), contrast = (Math.max(l, background) + .05) / (Math.min(l, background) + .05); if (contrast >= 3) visiblePixels++; peakContrast = Math.max(peakContrast, contrast); }
  if (process.env.ADMIN_SCREENSHOT_DIR) {
    const directory = resolve(process.env.ADMIN_SCREENSHOT_DIR); assert.ok(!directory.startsWith(resolve(".") + sep), "Evidence must stay outside the repository."); await mkdir(directory, { recursive: true });
    const prefix = process.env.PICKER_EVIDENCE_PREFIX === "before" ? "before" : "after";
    await writeFile(join(directory, `picker-${prefix}-${channel}-${type}-${width}.png`), png);
  }
  return { type, visiblePixels, peakContrast: Number(peakContrast.toFixed(2)), background: metrics.background };
}

for (const width of [320, 768, 1024, 1440]) for (const channel of ["ZOOM", "BOUTIQUE"] as const) test(`${channel} native consultation controls retain contrast and interactions at ${width}px`, { timeout: 60000 }, async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 1000 }, deviceScaleFactor: 1, reducedMotion: "reduce", locale: "en-US" });
  context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(30000);
  let mutations = 0; const errors: string[] = [];
  await context.route("**/*", async (route: { request(): { method(): string; url(): string }; continue(): Promise<void>; abort(): Promise<void> }) => {
    if (!['GET', 'HEAD'].includes(route.request().method())) { mutations++; await route.abort(); } else if (new URL(route.request().url()).origin !== origin) await route.abort(); else await route.continue();
  });
  try {
    await h.customerContext(context); const page = await context.newPage(); page.on("pageerror", () => errors.push("Page runtime error"));
    assert.equal((await page.goto(origin + "/appointment", { waitUntil: "networkidle" }))!.status(), 200); assert.match(await page.title(), /Private Appointments/);
    assert.equal(await page.locator("nextjs-portal").count(), 0); await page.getByLabel("Consultation preference", { exact: true }).selectOption(channel);
    const date = page.locator('input[name="preferredDate"]'), time = page.locator('input[name="preferredTime"]');
    await date.fill("2030-01-15"); await time.fill("14:30");
    const styles = Object.fromEntries(await Promise.all(["preferredDate", "preferredTime", "name", "email", "message", "channel"].map(async name => [name, await signature(page, name)])));
    const icons = [await iconContrast(page, "date", width, channel), await iconContrast(page, "time", width, channel)];
    if (process.env.ADMIN_SCREENSHOT_DIR) { const directory = resolve(process.env.ADMIN_SCREENSHOT_DIR), prefix = process.env.PICKER_EVIDENCE_PREFIX === "before" ? "before" : "after"; await writeFile(join(directory, `picker-${prefix}-${channel}-${width}.json`), JSON.stringify({ styles, icons }, null, 2)); }
    for (const icon of icons) assert.ok(icon.visiblePixels >= 24 && icon.peakContrast >= 7, `Native ${icon.type} indicator must be visible on the dark surface: ${JSON.stringify(icon)}`);
    for (const name of ["preferredDate", "preferredTime"]) { assert.equal(styles[name].colorScheme, "dark"); assert.equal(styles[name].background, "rgb(9, 8, 7)"); assert.equal(styles[name].color, "rgb(247, 240, 230)"); assert.ok(styles[name].height >= 48); }
    for (const name of ["name", "email", "message", "channel"]) assert.equal(styles[name].colorScheme, "normal", `${name} must retain its original scheme`);
    for (const input of [date, time]) {
      const original = await input.inputValue(); await input.focus(); await page.keyboard.press("ArrowUp"); assert.notEqual(await input.inputValue(), original, "Native keyboard segments must still change the value."); assert.equal(await input.evaluate((element: HTMLInputElement) => element.validity.valid), true);
      await input.fill(original); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
      const focus = await input.evaluate((element: HTMLInputElement) => { const s = getComputedStyle(element); return { focused: element === document.activeElement, visible: element.matches(":focus-visible"), outline: s.outline, offset: s.outlineOffset }; });
      assert.equal(focus.focused, true); assert.equal(focus.visible, true); assert.equal(focus.outline, "rgb(201, 164, 92) solid 2px"); assert.equal(focus.offset, "4px");
      await input.evaluate((element: HTMLInputElement) => { element.addEventListener("click", event => { try { element.showPicker(); element.dataset.pickerProbe = event.isTrusted ? "opened" : "untrusted"; } catch (error) { element.dataset.pickerProbe = (error as Error).name; } }, { once: true }); });
      await input.click({ position: { x: 20, y: 20 } }); assert.equal(await input.getAttribute("data-picker-probe"), "opened", "A trusted user gesture must open the supported native picker."); await page.keyboard.press("Escape");
      assert.equal(await input.inputValue(), original); assert.equal(await input.isEnabled(), true);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.equal(mutations, 0); assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
