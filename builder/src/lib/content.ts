// Loads the editable YAML files from CONTENT_DIR and the fetched JSON from DATA_DIR at build time.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { parseHours, type Week } from './hours';

const CONTENT_DIR = process.env.CONTENT_DIR ?? path.resolve('../content');
const DATA_DIR = process.env.DATA_DIR ?? path.resolve('.data');

const yaml = <T>(file: string, fallback: T): T => {
  const full = path.join(CONTENT_DIR, file);
  return existsSync(full) ? ((YAML.parse(readFileSync(full, 'utf8')) as T) ?? fallback) : fallback;
};
const json = <T>(file: string, fallback: T): T => {
  const full = path.join(DATA_DIR, file);
  return existsSync(full) ? (JSON.parse(readFileSync(full, 'utf8')) as T) : fallback;
};

export interface Site {
  domain: string;
  title: string;
  highlightKeywords: string[];
  newsMaxAgeDays?: number;
  impressum: { name: string; street: string; city: string; email: string; phone?: string };
  logRetentionDays: number;
}
export interface LinkItem { label: string; label_en?: string; url: string; value?: string }
export interface Headline { title: string; url: string; date: string | null; source: string; sourceUrl?: string }
export interface Event { date: string; end?: string | null; time?: string; title: string; organiser: string; url: string }
export interface Shop {
  name: string; category: string; address: string; phone?: string; url?: string;
  hours?: string; checked?: string | null; week: Week | null;
}

interface FeedSource { id: string; name: string; homepage: string; feed: string; max?: number }
interface Sources { clubKeywords?: string[]; feeds?: FeedSource[]; pages?: unknown[]; calendars?: { id: string }[] }

export const site = yaml<Site>('site.yaml', {} as Site);
export const links = yaml<Record<string, LinkItem[]>>('links.yaml', {});
export const sources = yaml<Sources>('sources.yaml', {});
export const status = json<{ fetchedAt?: string }>('status.json', {});

export const shops: Shop[] = yaml<Omit<Shop, 'week'>[]>('shops.yaml', []).map((s) => ({
  ...s,
  checked: s.checked ? String(s.checked) : null,
  week: parseHours(s.hours),
}));

const news = json<{ feeds: Record<string, (Omit<Headline, 'source'> & { source?: string })[]>; pages: Headline[] }>(
  'news.json',
  { feeds: {}, pages: [] },
);

const byDateDesc = (a: Headline, b: Headline) => (b.date ?? '').localeCompare(a.date ?? '');
const maxAgeMs = (site.newsMaxAgeDays ?? 45) * 86_400_000;
const buildTime = Date.now();
/** Dated within newsMaxAgeDays. Undated headlines count as fresh only where noted. */
const isRecent = (h: Headline) => h.date !== null && buildTime - Date.parse(h.date) <= maxAgeMs;

/** Headlines per feed source, in the order of sources.yaml, without old ones. */
export const newsBySource = (sources.feeds ?? []).map((src) => ({
  ...src,
  items: (news.feeds[src.id] ?? [])
    .map((i) => ({ ...i, source: i.source ?? src.name, sourceUrl: i.source ? undefined : src.homepage }))
    .filter((h) => h.date === null || isRecent(h)),
}));

export const singlePages: Headline[] = (news.pages ?? []).map((p) => ({ ...p, title: p.title || p.url }));

// The same story often comes from several feeds (e.g. a local site and a news aggregator); keep the first.
const titleKey = (h: Headline) => h.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const seen = new Set<string>();
/** Recent headlines from all sources, newest first, one per story. */
export const allHeadlines: Headline[] = [...newsBySource.flatMap((s) => s.items), ...singlePages]
  .filter(isRecent)
  .sort(byDateDesc)
  .filter((h) => !seen.has(titleKey(h)) && seen.add(titleKey(h)));

// Club news: the club's own feed plus headlines from any source that name the club.
const clubWords = (sources.clubKeywords ?? ['Germania Geyen']).map((k) => k.toLowerCase());
const clubFeed: Headline[] = newsBySource.find((s) => s.id === 'germania')?.items ?? [];
export const clubNews: Headline[] = [
  ...clubFeed,
  ...allHeadlines.filter((h) => !clubFeed.includes(h) && clubWords.some((k) => h.title.toLowerCase().includes(k))),
].sort(byDateDesc);

const keywords = (site.highlightKeywords ?? ['Geyen']).map((k) => k.toLowerCase());
export const highlighted = allHeadlines.filter((h) => keywords.some((k) => h.title.toLowerCase().includes(k)));

const today = new Date().toISOString().slice(0, 10);
const manualEvents = yaml<Event[]>('events.yaml', []).map((e) => ({
  ...e,
  date: String(e.date),
  end: e.end ? String(e.end) : null,
}));
const feedEvents = Object.values(json<Record<string, Event[]>>('calendars.json', {})).flat();

/** Upcoming events (including ones still running), soonest first. */
export const events: Event[] = [...manualEvents, ...feedEvents]
  .filter((e) => (e.end ?? e.date).slice(0, 10) >= today)
  .sort((a, b) => a.date.localeCompare(b.date));

export const label = (item: LinkItem, lang: 'de' | 'en') => (lang === 'en' && item.label_en) || item.label;
