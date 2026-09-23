export function normalizePhone(raw: string): { phoneE164: string | null } {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  if (digits.startsWith("9191") && digits.length === 14) digits = digits.slice(2);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 8 || digits.length > 15) return { phoneE164: null };
  return { phoneE164: `+${digits}` };
}

export function normalizeEmail(raw?: string | null): string | null {
  const normalized = raw?.trim().toLowerCase();
  return normalized || null;
}

export function titleCaseName(raw?: string | null): string | null {
  if (!raw?.trim()) return null;
  return raw.trim().toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (letter) => letter.toUpperCase());
}
