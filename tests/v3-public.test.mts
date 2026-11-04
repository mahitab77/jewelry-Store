import assert from "node:assert/strict";
import { test } from "node:test";
import { variantOptionLabels } from "../src/lib/catalogue/presentation.ts";
import type { PublicVariant } from "../src/lib/catalogue/types.ts";
const variant = (sku: string, extra: Partial<PublicVariant> = {}): PublicVariant => ({ id: sku, sku, size: null, configuration: null, metalType: null, metalPurity: null, metalColor: null, price: { currency: "EGP", amountMinor: "245000" }, availability: "IN_STOCK", canPurchase: true, ...extra });
test("variant options distinguish stored size, configuration and metal without changing data", () => {
  const values = [variant("A", { size: "54", configuration: "Yellow setting", metalType: "Gold", metalPurity: "18K" }), variant("B", { size: "54", configuration: "White setting", metalType: "Gold", metalColor: "White" })];
  const original = structuredClone(values), labels = variantOptionLabels(values);
  assert.match(labels[0].visible, /54.*Yellow setting.*Gold 18K/);
  assert.match(labels[1].accessible, /54.*White setting.*Gold White/);
  assert.notEqual(labels[0].accessible, labels[1].accessible); assert.deepEqual(values, original);
});
test("legacy duplicate descriptions and shortened options retain unique stored references", () => {
  const duplicate = variantOptionLabels([variant("ONE", { size: "54" }), variant("TWO", { size: "54" })]);
  assert.match(duplicate[0].visible, /Reference ONE/); assert.match(duplicate[1].accessible, /Reference TWO/);
  const description = "Configuration ".repeat(19), long = variantOptionLabels([variant("LONG", { configuration: description })])[0];
  assert.match(long.visible, /….*Reference LONG/); assert.ok(long.accessible.includes(description.trim()));
  assert.ok(long.visible.length < 100);
});
test("empty variant descriptions retain sensible stable configuration fallbacks", () => {
  const labels = variantOptionLabels([variant("A"), variant("B")]);
  assert.equal(labels[0].visible, "Standard configuration"); assert.equal(labels[1].accessible, "Configuration 2");
  assert.deepEqual(variantOptionLabels([]), []);
});
