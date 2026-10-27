import assert from "node:assert/strict";
import { test } from "node:test";
import { cataloguePageHref, formatEgp, isCatalogueSlug, isDevelopmentEntry, parseCatalogueQuery,
  productTypeLabel, publicImageSource } from "../src/lib/catalogue/presentation.ts";

test("EGP presentation uses exact minor units without floating point", () => {
  assert.equal(formatEgp({ currency: "EGP", amountMinor: "1599000" }), "EGP 15,990.00");
  assert.equal(formatEgp({ currency: "EGP", amountMinor: "9007199254740993" }), "EGP 90,071,992,547,409.93");
  assert.equal(formatEgp({ currency: "EGP", amountMinor: "1" }), "EGP 0.01");
  assert.equal(formatEgp({ currency: "EGP", amountMinor: "0" }), "EGP 0.00");
  assert.equal(formatEgp(null), "Price on Request");
  assert.equal(formatEgp({ currency: "EGP", amountMinor: "NaN" }), "Price on Request");
});

test("pagination/sorting validation matches repository bounds", () => {
  assert.deepEqual(parseCatalogueQuery({}), { page: 1, sort: "newest" });
  assert.deepEqual(parseCatalogueQuery({ page: "834", sort: "name_asc" }), { page: 834, sort: "name_asc" });
  for (const page of ["0", "-1", "01", "835", "1.5", "Infinity", "x", ["1", "2"]]) assert.equal(parseCatalogueQuery({ page }), null);
  assert.equal(parseCatalogueQuery({ sort: "name;DROP TABLE products" }), null);
  assert.equal(parseCatalogueQuery({ sort: ["newest", "name_asc"] }), null);
  assert.equal(cataloguePageHref("/collections/rings", 2, "name_asc"), "/collections/rings?page=2&sort=name_asc");
  assert.equal(cataloguePageHref("/collections", 1, "newest"), "/collections");
});

test("only valid stored slugs and supported local image references are accepted", () => {
  assert.equal(isCatalogueSlug("necklaces-pendants"), true);
  for (const slug of ["", "../orders", "Rings", "rings?all=true", "x' OR 1=1--", "a".repeat(161), undefined]) assert.equal(isCatalogueSlug(slug), false);
  const photo = { id: "photo", type: "IMAGE" as const, reference: "/images/ring-emerald-no-bg.png", altText: null, isPrimary: true };
  assert.equal(publicImageSource(photo), photo.reference);
  assert.equal(publicImageSource(null), null);
  for (const reference of ["//unknown.invalid/image.png", "https://unknown.invalid/a.png", "/images/../secret.png", "/images/a.svg", "private-certificate"]) {
    assert.equal(publicImageSource({ ...photo, reference }), null);
  }
  assert.equal(publicImageSource({ ...photo, type: "VIDEO" }), null);
});

test("development fixtures are identifiable for visible labelling and noindex", () => {
  assert.equal(isDevelopmentEntry({ id: "02000000-0000-4000-8000-000000000101", slug: "rings", name: "Ring" }), true);
  assert.equal(isDevelopmentEntry({ id: "other", slug: "dev-ring", name: "Ring" }), true);
  assert.equal(isDevelopmentEntry({ id: "other", slug: "ring", name: "[DEVELOPMENT] Ring" }), true);
  assert.equal(isDevelopmentEntry({ id: "other", slug: "ring", name: "Ring" }), false);
  assert.equal(productTypeLabel("BESPOKE"), "Bespoke commission");
  assert.equal(productTypeLabel("ONE_OF_A_KIND"), "One of a kind");
});
