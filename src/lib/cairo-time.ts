const CAIRO_TZ = "Africa/Cairo";

function toDate(value: Date | string | number) {
  return value instanceof Date ? value : new Date(value);
}

function cairoParts(date: Date | string | number) {
  const d = toDate(date);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

export function formatCairoDateTime(value: Date | string | number) {
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: CAIRO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(toDate(value));
}

export function formatCairoDate(value: Date | string | number) {
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: CAIRO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(toDate(value));
}

export function getCairoNow() {
  const now = new Date();
  const p = cairoParts(now);
  return {
    raw: now,
    ...p,
  };
}

export function getCairoDayRange(base: Date | string | number = new Date()) {
  const p = cairoParts(base);

  const startUtc = new Date(
    Date.UTC(p.year, p.month - 1, p.day, 0 - 2, 0, 0, 0)
  );
  const endUtc = new Date(
    Date.UTC(p.year, p.month - 1, p.day + 1, 0 - 2, 0, 0, 0)
  );

  return {
    start: startUtc,
    end: endUtc,
  };
}

export function addDays(date: Date | string | number, days: number) {
  const d = new Date(toDate(date));
  d.setDate(d.getDate() + days);
  return d;
}

export function isAfterShiftAutoClose(base: Date | string | number = new Date()) {
  const p = cairoParts(base);
  return p.hour > 23 || (p.hour === 23 && p.minute >= 55);
}

export function getShiftAutoCloseLabel() {
  return "11:55 م";
}