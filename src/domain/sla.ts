export interface DailyHours { weekday: number; opensAt: string; closesAt: string; enabled: boolean }
export interface Holiday { date: string; closed: boolean; opensAt?: string; closesAt?: string }

const minute = 60_000;

function partsInZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday: weekdays[get("weekday")], time: `${get("hour")}:${get("minute")}` };
}

export function isBusinessMinute(value: Date, hours: DailyHours[], holidays: Holiday[], timeZone = "Asia/Kolkata"): boolean {
  const local = partsInZone(value, timeZone);
  const holiday = holidays.find((item) => item.date === local.date);
  if (holiday?.closed) return false;
  const schedule = hours.find((item) => item.weekday === local.weekday && item.enabled);
  const opensAt = holiday?.opensAt ?? schedule?.opensAt;
  const closesAt = holiday?.closesAt ?? schedule?.closesAt;
  return Boolean(opensAt && closesAt && local.time >= opensAt && local.time < closesAt);
}

export function addBusinessMinutes(start: Date, amount: number, hours: DailyHours[], holidays: Holiday[] = [], timeZone = "Asia/Kolkata"): Date {
  if (amount < 0) throw new Error("Business minutes cannot be negative");
  let cursor = new Date(start);
  let remaining = amount;
  let guard = 0;
  while (!isBusinessMinute(cursor, hours, holidays, timeZone)) {
    cursor = new Date(cursor.getTime() + minute);
    guard += 1;
    if (guard > 60 * 24 * 370) throw new Error("No business minutes found within one year");
  }
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + minute);
    if (isBusinessMinute(cursor, hours, holidays, timeZone)) remaining -= 1;
    guard += 1;
    if (guard > 60 * 24 * 370) throw new Error("No business minutes found within one year");
  }
  return cursor;
}

export function computeSlaDueAt(input: { receivedAt: Date; isInternational: boolean; targetMinutes?: number; hours: DailyHours[]; holidays?: Holiday[] }): Date {
  const target = input.targetMinutes ?? 5;
  return input.isInternational
    ? new Date(input.receivedAt.getTime() + target * minute)
    : addBusinessMinutes(input.receivedAt, target, input.hours, input.holidays);
}
