import "server-only";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { fail } from "./validation.ts";

// All application slug/SKU writers take this transaction lock, including manual
// overrides. UNIQUE constraints remain authoritative for writers outside the app.
export async function lockAutomaticValues(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(1781642321,3)");
}

export function slugFromName(name: string, fallback: string): string {
  const normalized = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || fallback).slice(0, 150).replace(/-+$/g, "");
}

export async function automaticSlug(client: PoolClient, table: "products" | "categories" | "collections", name: string): Promise<string> {
  const base = slugFromName(name, table === "products" ? "jewelry" : table === "categories" ? "category" : "collection");
  for (let suffix = 1; suffix <= 10001; suffix++) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (!(await client.query(`SELECT id FROM ${table} WHERE slug=$1`, [candidate])).rowCount) return candidate;
  }
  fail("A URL could not be allocated for this name. Choose a URL in Additional Details.", 409);
}

export async function automaticSku(client: PoolClient): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const sku = "LPD-" + randomBytes(12).toString("hex").toUpperCase();
    if (!(await client.query("SELECT id FROM product_variants WHERE sku=$1", [sku])).rowCount) return sku;
  }
  fail("A product reference could not be allocated. Try again after reviewing the saved state.", 409);
}
