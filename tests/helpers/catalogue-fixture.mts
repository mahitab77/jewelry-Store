import { adminFixture, sessionCookie } from "./admin-fixture.mts";
import { seedDevelopment } from "../../db/tools/seed.ts";
import { handleAdminAuth } from "../../src/lib/admin/http.ts";
import { closeDatabase } from "../../src/lib/db/client.ts";
import type { AdminRole } from "../../src/lib/admin/policy.ts";
import type { EditorProduct, ProductInput, VariantInput } from "../../src/lib/admin/catalogue/types.ts";
import assert from "node:assert/strict";

export async function catalogueFixture(baseURL?: string) {
  const fixture = await adminFixture(baseURL);
  try {
    const role = `"${fixture.role}"`;
    await fixture.data.query(`GRANT SELECT ON categories,collections TO ${role}`);
    await fixture.data.query(`GRANT SELECT,INSERT,UPDATE ON products,product_variants,product_prices,inventory TO ${role}`);
    await fixture.data.query(`GRANT SELECT,INSERT ON gemstones TO ${role}`);
    await fixture.data.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON product_categories,product_collections,product_gemstones,product_media TO ${role}`);
    await fixture.data.query(`GRANT SELECT,INSERT,UPDATE ON catalogue_media_jobs TO ${role}`);
    await fixture.data.query(`GRANT SELECT ON audit_events TO ${role}`);
    await seedDevelopment(fixture.ownerUrl, true);
    return { ...fixture, async headers(role: AdminRole = "OWNER") {
      const response = await handleAdminAuth(new Request(fixture.authConfig.baseURL + "/api/admin-auth/sign-in/email", { method: "POST", headers: { Origin: fixture.authConfig.baseURL, "Content-Type": "application/json" }, body: JSON.stringify({ email: fixture.users[role].email, password: fixture.password }) }), fixture.runtime);
      assert.equal(response.status, 200, "A disposable administrator should sign in.");
      return new Headers({ Cookie: sessionCookie(response) });
    }, async close() { await closeDatabase(); await fixture.close(); } };
  } catch (error) { await fixture.close(); throw error; }
}
export function variant(sku: string, extra: Partial<VariantInput> = {}): VariantInput {
  return { sku, size: "", configuration: "", metalType: "", metalPurity: "", metalColor: "", active: true, displayOrder: 0, priceEGP: "", initialStock: 0, stockReason: "", gemstones: [], ...extra };
}
export function product(name: string, extra: Partial<ProductInput> = {}): ProductInput {
  return { name, slug: name.toLowerCase().replaceAll(" ", "-"), description: "Disposable catalogue fixture only.", productType: "REPEATABLE", salesMode: "ENQUIRY_ONLY", categoryIds: [], collectionIds: [], variants: [], ...extra };
}
export function editable(p: EditorProduct): ProductInput {
  return { name: p.name, slug: p.slug, description: p.description, productType: p.productType, salesMode: p.salesMode, categoryIds: [...p.categoryIds], collectionIds: [...p.collectionIds],
    variants: p.variants.map((v) => ({ id: v.id, sku: v.sku, size: v.size, configuration: v.configuration, metalType: v.metalType, metalPurity: v.metalPurity, metalColor: v.metalColor, active: v.active, displayOrder: v.displayOrder, priceEGP: v.priceEGP, gemstones: v.gemstones.map((g) => ({ ...g })) })) };
}
