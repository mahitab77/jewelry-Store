import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogueAdminError, egpToMinor, parseSubmission } from "../src/lib/admin/catalogue/validation.ts";
import { product, variant } from "./helpers/catalogue-fixture.mts";
import type { StoneInput } from "../src/lib/admin/catalogue/types.ts";

test("server validation identifies the second variant price while preserving its existing safe message and exact EGP arithmetic", () => {
  const input = product("Local structured price fixture", { salesMode: "DIRECT_PURCHASE", variants: [variant("LOCAL-FIELD-ONE", { priceEGP: "10.01" }), variant("LOCAL-FIELD-TWO", { priceEGP: "12.345", configuration: "Different configuration" })] });
  assert.throws(() => parseSubmission({ product: input, action: "save" }), (error: unknown) => {
    assert.ok(error instanceof CatalogueAdminError);
    assert.equal(error.status, 400); assert.equal(error.fieldPath, "product.variants.1.priceEGP");
    assert.equal(error.message, "Enter an EGP price with at most two decimal places, without commas."); return true;
  });
  input.variants[1].priceEGP = "90071992547409.93";
  assert.equal(egpToMinor(parseSubmission({ product: input, action: "save" }).product.variants[1].priceEGP), "9007199254740993");
});

test("nested gemstone validation identifies its own repeated control without changing provenance or report rules", () => {
  const stone: StoneInput = { kind: "GROUP", type: "Local fixture", variety: "", shape: "Round", color: "Blue", caratWeight: "1.25", origin: "", treatment: "", laboratory: "", reportReference: "", role: "CENTER", quantity: 1, totalCaratWeight: "", displayOrder: 0 };
  const input = product("Local structured gemstone fixture", { variants: [variant("LOCAL-FIELD-STONE", { gemstones: [stone, { ...stone, reportReference: "LOCAL-NOT-A-CERTIFICATE" }] })] });
  assert.throws(() => parseSubmission({ product: input, action: "save" }), (error: unknown) => {
    assert.ok(error instanceof CatalogueAdminError); assert.equal(error.fieldPath, "product.variants.0.gemstones.1.laboratory");
    assert.equal(error.message, "Provide a laboratory with a report reference."); return true;
  });
});

test("duplicate and over-limit variant fields remain rejected and identify the affected input", () => {
  const input = product("Local duplicate field fixture", { variants: [variant("LOCAL-DUPLICATE"), variant("LOCAL-DUPLICATE", { configuration: "Different configuration" })] });
  assert.throws(() => parseSubmission({ product: input, action: "save" }), (error: unknown) => error instanceof CatalogueAdminError && error.fieldPath === "product.variants.1.sku");
  input.variants[1].sku = "A".repeat(81);
  assert.throws(() => parseSubmission({ product: input, action: "save" }), (error: unknown) => error instanceof CatalogueAdminError && error.fieldPath === "product.variants.1.sku");
  input.variants[1].sku = "A".repeat(80);
  assert.equal(parseSubmission({ product: input, action: "save" }).product.variants[1].sku.length, 80);
});
