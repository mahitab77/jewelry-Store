import { runMigrations, MigrationError } from "../db/tools/migrate.ts";
import { seedDevelopment } from "../db/tools/seed.ts";
import { LocalDatabaseError } from "../db/tools/local.ts";
import { DatabaseError } from "../src/lib/db/config.ts";

try {
  const [command, ...flags] = process.argv.slice(2);
  if (command === "migrate" && flags.includes("--local") && flags.every((f) => ["--local", "--adopt-existing"].includes(f))) {
    const applied = await runMigrations(process.env.DATABASE_URL, { adoptExisting: flags.includes("--adopt-existing") });
    console.log(applied.length ? `Applied ${applied.length} migration(s): ${applied.join(", ")}` : "Migration history verified; no pending migrations.");
  } else if (command === "seed" && flags.length === 1 && flags[0] === "--development") {
    await seedDevelopment(process.env.DATABASE_URL, true);
    console.log("Development catalogue fixtures are present.");
  } else {
    throw new LocalDatabaseError();
  }
} catch (error) {
  console.error(error instanceof DatabaseError || error instanceof MigrationError || error instanceof LocalDatabaseError
    ? error.message : "Database tooling failed. Check local configuration and migration files.");
  process.exitCode = 1;
}
