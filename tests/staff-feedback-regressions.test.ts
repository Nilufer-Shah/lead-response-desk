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
    expect(detail).toContain('disabled={saving}>{saving ? "Saving…" : "Save"}');
    expect(styles).toContain(".action-sheet { width: min(620px, 100%); max-height:");
    expect(styles).toContain(".primary-form-button { width: 100%;");
  });

  it("renders long waiting times in readable hours", () => {
    expect(formatDurationMinutes(null)).toBe("—");
    expect(formatDurationMinutes(10)).toBe("10 min");
    expect(formatDurationMinutes(60)).toBe("1h");
    expect(formatDurationMinutes(1455)).toBe("24h 15m");
  });
});
