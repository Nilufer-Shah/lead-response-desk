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

  it("uses password hashes and password-only sign-in endpoints", () => {
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

  it("keeps missed follow-ups visible and makes dashboard periods unambiguous", () => {
    const queue = read("src/components/today-queue.tsx");
    expect(queue).toContain("Missed follow-ups");
    expect(queue).toContain("data.missedFollowups.map");
    const dashboard = read("src/components/product-dashboard.tsx");
    expect(dashboard).toContain("Waiting right now (all dates)");
    expect(dashboard).toContain("Live, regardless of date filter.");
    expect(dashboard).toContain("New leads ({periodLabel})");
  });

  it("keeps development and persistent actions clear of mobile navigation", () => {
    expect(read("next.config.ts")).toContain("devIndicators: false");
    const styles = read("src/app/globals.css");
    expect(styles).toContain(".main-stage { padding: 0 14px 98px; }");
    expect(styles).toContain(".mobile-bottom-nav { position: fixed; z-index: 50;");
    expect(styles).toContain(".call-next, .lead-actions { bottom: calc(68px + env(safe-area-inset-bottom)); }");
    expect(styles).toContain(".saved-toast { position: fixed; z-index: 40; left: 50%; bottom: 92px;");
  });
});
