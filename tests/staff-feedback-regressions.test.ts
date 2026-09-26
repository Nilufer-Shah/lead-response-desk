import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDurationMinutes } from "@/components/product-dashboard";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("staff feedback regressions", () => {
  it("suppresses harmless body-attribute hydration mismatches from browser extensions", () => {
    expect(read("src/app/layout.tsx")).toContain("suppressHydrationWarning");
  });

  it("labels the owner lead-intake link as Sheet settings and anchors its destination", () => {
    const inbox = read("src/components/lead-inbox.tsx");
    const admin = read("src/components/admin-console.tsx");
    expect(inbox).toContain('href="/admin#google-sheet-intake"');
    expect(inbox).toContain("Sheet intake settings");
    expect(inbox).not.toContain("Import leads");
    expect(admin).toContain('id="google-sheet-intake"');
    expect(admin).toContain("syncing cannot start until the deployment team adds");
  });

  it("keeps filtered lead counts in one place instead of showing a stale page total", () => {
    expect(read("src/app/leads/page.tsx")).not.toContain("`${leads.length} visible leads`");
    expect(read("src/components/lead-inbox.tsx")).toContain("{leads.length} visible");
  });

  it("shows follow-up API errors inside a full-width, guarded action form", () => {
    const detail = read("src/components/lead-detail.tsx");
    const styles = read("src/app/globals.css");
    expect(detail).toContain('className="action-sheet-error" role="alert"');
    expect(detail).toContain("first tap Call or WhatsApp");
    expect(detail).toContain('disabled={saving}>{saving ? "Saving…"');
    expect(styles).toContain(".action-sheet { width: min(620px, 100%); max-height:");
    expect(styles).toContain(".primary-form-button { width: 100%;");
  });

  it("renders long waiting times in readable hours", () => {
    expect(formatDurationMinutes(null)).toBe("—");
    expect(formatDurationMinutes(10)).toBe("10 min");
    expect(formatDurationMinutes(60)).toBe("1h");
    expect(formatDurationMinutes(1455)).toBe("24h 15m");
  });

  it("provides dashboard navigation and a targeted all-date missed section", () => {
    const queue = read("src/components/today-queue.tsx");
    const dashboard = read("src/components/product-dashboard.tsx");
    expect(queue).toContain('aria-label="Back to dashboard"');
    expect(queue).toContain('id="missed-followups"');
    expect(queue).toContain("Missed follow-ups · all dates");
    expect(dashboard).toContain('href="/today#missed-followups"');
    expect(dashboard).toContain("Due-today items are not missed yet");
  });

  it("handles refresh failures and prevents duplicate form submissions", () => {
    const queue = read("src/components/today-queue.tsx");
    const dashboard = read("src/components/product-dashboard.tsx");
    const detail = read("src/components/lead-detail.tsx");
    expect(queue).toContain("Could not refresh. Showing the last available queue.");
    expect(dashboard).toContain("Could not refresh. Showing the last available dashboard.");
    expect(queue).toContain("if (submitting.current) return");
    expect(detail).toContain("if (submitting.current) return");
  });

  it("creates a new enquiry instead of rewriting a closed outcome", () => {
    const detail = read("src/components/lead-detail.tsx");
    const route = read("src/app/api/leads/[id]/repeat/route.ts");
    expect(detail).toContain("Create new enquiry");
    expect(detail).toContain("keeps the previous outcome unchanged");
    expect(route).toContain("ingestLead(transaction");
    expect(route).toContain("stage IN ('won','dead','bad')");
  });
});
