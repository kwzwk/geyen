// Minimal parser for OpenStreetMap-style opening hours, e.g.
// "Mo-Fr 08:00-12:30,14:30-18:30; Sa 08:00-13:00; Su off".
// Supports day lists and ranges, several time spans per day, "off"/"closed" and "24/7".
// Public-holiday rules (PH) are ignored. Shared by the build and the "open now" badge.

export type Span = [number, number]; // minutes since midnight, end may be > 1440 past midnight
export type Week = Span[][]; // index 0 = Monday … 6 = Sunday

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function parseDays(selector: string): number[] | null {
  const days = new Set<number>();
  for (const part of selector.split(',')) {
    const [from, to] = part.trim().split('-');
    const start = DAYS.indexOf(from);
    if (start < 0) return null;
    const end = to === undefined ? start : DAYS.indexOf(to);
    if (end < 0) return null;
    for (let i = start; ; i = (i + 1) % 7) {
      days.add(i);
      if (i === end) break;
    }
  }
  return [...days];
}

function parseSpans(text: string): Span[] | null {
  if (/^(off|closed)$/i.test(text)) return [];
  const spans: Span[] = [];
  for (const part of text.split(',')) {
    const match = part.trim().match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
    if (!match) return null;
    const start = toMinutes(match[1]);
    let end = toMinutes(match[2]);
    if (end <= start) end += 24 * 60;
    spans.push([start, end]);
  }
  return spans;
}

/** Returns the weekly schedule, or null when the string can't be parsed. */
export function parseHours(value: string | null | undefined): Week | null {
  if (!value) return null;
  if (value.trim() === '24/7') return DAYS.map(() => [[0, 24 * 60]]);
  const week: Week = DAYS.map(() => []);
  for (const rule of value.split(';').map((r) => r.trim()).filter(Boolean)) {
    if (/^PH\b/.test(rule)) continue;
    const match = rule.match(/^([A-Za-z,\- ]+?)\s+(.+)$/);
    if (!match) return null;
    const days = parseDays(match[1].replace(/\s/g, ''));
    const spans = parseSpans(match[2].trim());
    if (!days || !spans) return null;
    for (const day of days) week[day] = spans;
  }
  return week;
}

/** Day index (Monday = 0) and minutes since midnight in Europe/Berlin. */
export function berlinNow(date = new Date()): { day: number; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  return { day, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function isOpen(week: Week, date = new Date()): boolean {
  const { day, minutes } = berlinNow(date);
  if (week[day].some(([s, e]) => minutes >= s && minutes < e)) return true;
  // Spans from the previous day that run past midnight.
  const yesterday = week[(day + 6) % 7];
  return yesterday.some(([, e]) => e > 24 * 60 && minutes + 24 * 60 < e);
}

const pad = (n: number) => String(n % (24 * 60) === 0 && n > 0 ? 24 : Math.floor((n % (24 * 60)) / 60)).padStart(2, '0');
const fmt = (n: number) => `${pad(n)}:${String(n % 60).padStart(2, '0')}`;

/** Groups consecutive days with identical hours into display rows. */
export function weekRows(week: Week, dayNames: string[], closedLabel: string): { days: string; hours: string }[] {
  const rows: { days: string; hours: string }[] = [];
  let i = 0;
  while (i < 7) {
    let j = i;
    const key = JSON.stringify(week[i]);
    while (j + 1 < 7 && JSON.stringify(week[j + 1]) === key) j++;
    rows.push({
      days: i === j ? dayNames[i] : `${dayNames[i]}–${dayNames[j]}`,
      hours: week[i].length ? week[i].map(([s, e]) => `${fmt(s)}–${fmt(e)}`).join(', ') : closedLabel,
    });
    i = j + 1;
  }
  return rows;
}
