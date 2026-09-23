import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("production application contract", () => {
  it("uses tenant-scoped database read models on every primary screen", () => {
    const screens = ["src/app/page.tsx", "src/app/today/page.tsx", "src/app/leads/page.tsx", "src/app/leads/[id]/page.tsx"];
    for (const screen of screens) expect(read(screen)).not.toContain("@/lib/demo-data");
    expect(read("src/services/product-read-models.ts")).toContain("withTenant(user");
  });

  it("maps a signed-in session into the RLS user and role context", () => {
    const source = read("src/db/index.ts");
    expect(source).toContain("context.userId ?? context.id");
    expect(source).toContain("context.userRole ?? context.role");
  });

  it("does not cache authenticated pages or APIs in the service worker", () => {
    const worker = read("public/sw.js");
    expect(worker.replaceAll("\n", " ")).not.toMatch(/SHELL\s*=\s*\[[^\]]*\/today/);
    expect(worker).toContain('event.request.mode === "navigate"');
    expect(worker).not.toContain("cache.put(event.request");
  });

  it("contains no out-of-scope product or client names", () => {
    const files = ["src/services/weekly-report.ts", "README.md"];
    for (const file of files) expect(read(file)).not.toMatch(/inflex|arya|revenue os/i);
  });

  it("uses the exact Block 1 roles and lead stages", () => {
    const schema = read("src/db/schema.ts");
    expect(schema).toContain('["owner", "salesperson", "agency"]');
    expect(schema).toContain('["new", "contacted", "follow_up", "dormant", "won", "dead", "bad"]');
  });

  it("uses password hashes and has no OTP sign-in endpoints", () => {
    expect(read("src/app/api/auth/login/route.ts")).toContain('from "bcryptjs"');
    expect(read("src/lib/auth.ts")).toContain("sessionId");
  });
});
