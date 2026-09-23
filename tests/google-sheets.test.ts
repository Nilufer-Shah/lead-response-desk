import { describe, expect, it } from "vitest";
import { externalIdForSheetRow, extractSpreadsheetId, googleSheetMappingSchema, parseSheetDate, rowsFromValues } from "@/integrations/google-sheets";

const mapping = googleSheetMappingSchema.parse({});

describe("Google Sheets intake", () => {
  it("extracts a spreadsheet ID from a share URL", () => {
    expect(extractSpreadsheetId("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
  });

  it("maps values using a configurable header row and skips blank lines", () => {
    const result = rowsFromValues([["title"], ["name", "phone"], ["Priya", "9876543210"], ["", ""]], 2);
    expect(result.headers).toEqual(["name", "phone"]);
    expect(result.rows).toEqual([{ rowNumber: 3, values: { name: "Priya", phone: "9876543210" } }]);
  });

  it("creates the same external ID when a row moves", () => {
    const values = { name: "Priya", phone: "9876543210", created_at: "13/09/2026 20:15" };
    const first = externalIdForSheetRow({ spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz", sheetName: "Leads", row: { rowNumber: 4, values }, mapping });
    const moved = externalIdForSheetRow({ spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz", sheetName: "Leads", row: { rowNumber: 9, values }, mapping });
    expect(moved).toBe(first);
  });

  it("parses Indian day-first timestamps in IST", () => {
    expect(parseSheetDate("13/09/2026 20:15", new Date(0)).toISOString()).toBe("2026-09-13T14:45:00.000Z");
  });
});
