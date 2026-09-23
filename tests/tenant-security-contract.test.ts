import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schemaSource = readFileSync(resolve(process.cwd(), "src/db/schema.ts"), "utf8");
const securityMigration = readFileSync(resolve(process.cwd(), "src/db/migrations/0001_security_and_invariants.sql"), "utf8");
const seedMigration = readFileSync(resolve(process.cwd(), "src/db/migrations/0002_roopkala_seed.sql"), "utf8");

describe("tenant security contract", () => {
  it("gives every declared app table a non-null tenant_id", () => {
    const blocks = [...schemaSource.matchAll(/export const (\w+) = app\.table\("([^"]+)", \{([\s\S]*?)\n\}(?:,|\);)/g)];
    expect(blocks.length).toBeGreaterThanOrEqual(30);
    const missing = blocks
      .filter((match) => !/tenantId:\s*(?:tenantId\(\)|uuid\("tenant_id"\).*\.notNull\(\)|uuid\("tenant_id"\).*\.primaryKey\(\))/.test(match[3]))
      .map((match) => match[2]);
    expect(missing).toEqual([]);
  });

  it("forces RLS and executes the database catalog assertion", () => {
    expect(securityMigration).toContain("ALTER TABLE app.%I FORCE ROW LEVEL SECURITY");
    expect(securityMigration).toContain("CREATE POLICY tenant_isolation");
    expect(seedMigration).toContain("SELECT app.assert_tenant_security()");
  });
});
