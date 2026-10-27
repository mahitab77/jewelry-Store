import { randomUUID } from "node:crypto";
import { closeDatabase } from "../../src/lib/db/client.ts";
import { catalogueFixture } from "./catalogue-fixture.mts";

export async function cartFixture(origin = "https://cart.boutique.test") {
  const f = await catalogueFixture(origin), suffix = randomUUID().replaceAll("-", "");
  const cartRole = `lapalme_cart_${suffix}`, readerRole = `lapalme_cart_reader_${suffix}`;
  const created: string[] = [];
  try {
    for (const role of [cartRole, readerRole]) {
      await f.data.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`); created.push(role);
      await f.data.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await f.data.query(`GRANT SELECT ON categories,collections,products,product_variants,product_prices,product_media,
        product_categories,product_collections,gemstones,product_gemstones,inventory TO "${role}"`);
    }
    await f.data.query(`GRANT SELECT,INSERT,UPDATE ON carts TO "${cartRole}"`);
    await f.data.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON cart_items,cart_rate_limits TO "${cartRole}"`);
    await f.data.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON checkout_drafts TO "${cartRole}"`);
    await f.data.query(`GRANT SELECT ON boutique_locations TO "${cartRole}"`);
    const cart = new URL(f.ownerUrl), reader = new URL(f.ownerUrl); cart.username = cartRole; cart.password = ""; reader.username = readerRole; reader.password = "";
    return { ...f, cartUrl: cart.toString(), readerUrl: reader.toString(), cartRole, readerRole,
      async close() { await closeDatabase(); for (const role of created) { await f.data.query(`DROP OWNED BY "${role}"`); await f.data.query(`DROP ROLE "${role}"`); } await f.close(); },
    };
  } catch (error) { for (const role of created) { await f.data.query(`DROP OWNED BY "${role}"`); await f.data.query(`DROP ROLE "${role}"`); } await f.close(); throw error; }
}
