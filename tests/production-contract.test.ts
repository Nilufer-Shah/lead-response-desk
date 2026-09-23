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

  it("ships no service worker or offline mutation queue", () => {
    expect(() => read("public/sw.js")).toThrow();
    expect(() => read("src/lib/offline-queue.ts")).toThrow();
  });

  it("contains no out-of-scope product or client names", () => {
    const files = ["README.md"];
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

  it("opens phone links synchronously while recording attempts in the background", () => {
    for (const component of ["src/components/today-queue.tsx", "src/components/lead-detail.tsx"]) {
      const source = read(component);
      expect(source).toContain("href={`tel:");
      expect(source).toContain("href={`https://wa.me/");
      expect(source).toContain("navigator.sendBeacon");
      expect(source).toContain("keepalive: true");
      expect(source).not.toMatch(/await\s+recordAttempt/);
    }
    expect(read("src/components/today-queue.tsx")).toContain("Quick note");
  });
});
