// Fetches headlines, page titles and calendar entries from the sources listed in
// content/sources.yaml and writes them to DATA_DIR as JSON for the Astro build.
// Only title, date and link are kept. A source that fails keeps its last good data.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Parser from 'rss-parser';
import ical from 'node-ical';
import YAML from 'yaml';

const CONTENT_DIR = process.env.CONTENT_DIR ?? path.resolve('../content');
const DATA_DIR = process.env.DATA_DIR ?? path.resolve('.data');
const USER_AGENT = process.env.USER_AGENT ?? 'geyen.org link list (+https://geyen.org)';
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 5 * 1024 * 1024;
const CALENDAR_DAYS_AHEAD = 365;

const log = (...args) => console.log(new Date().toISOString(), '[fetch]', ...args);

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  const target = path.join(DATA_DIR, file);
  await writeFile(`${target}.tmp`, JSON.stringify(data, null, 2));
  await rename(`${target}.tmp`, target);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new Error('response too large');
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('response too large');
  return text;
}

const isHttpUrl = (value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const cleanTitle = (value) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const decodeEntities = (value) =>
  value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

// Case-insensitive substring match of any keyword.
const matchesKeywords = (text, keywords) => {
  const haystack = text.toLowerCase();
  return keywords.some((k) => haystack.includes(String(k).toLowerCase()));
};

/**
 * Turns one parsed feed item into { title, url, date, source? }, or null when it is unusable
 * or filtered out. The summary and categories are only used for the keyword filter, never stored.
 */
export function toHeadline(item, source) {
  let title = cleanTitle(item.title);
  let itemSource;
  if (source.sourceFromItem) {
    // Aggregators such as Google News name the publisher in <source> and append " - Publisher" to the title.
    itemSource = cleanTitle(typeof item.source === 'object' ? item.source?._ ?? item.source?.$?.url : item.source);
    if (itemSource && title.endsWith(` - ${itemSource}`)) title = title.slice(0, -itemSource.length - 3).trim();
  }
  if (!title || !isHttpUrl(item.link)) return null;
  if (source.include?.length) {
    const categories = (item.categories ?? []).map((c) => (typeof c === 'object' ? c._ ?? '' : c));
    const text = [title, item.contentSnippet ?? '', ...categories].join(' ');
    if (!matchesKeywords(text, source.include)) return null;
  }
  return { title, url: item.link, date: item.isoDate ?? null, ...(itemSource ? { source: itemSource } : {}) };
}

async function fetchFeeds(feeds, previous) {
  const parser = new Parser({ customFields: { item: ['source'] } });
  const result = {};
  const status = {};
  for (const source of feeds) {
    try {
      const xml = await fetchText(source.feed);
      const feed = await parser.parseString(xml);
      const items = (feed.items ?? [])
        .map((item) => toHeadline(item, source))
        .filter(Boolean)
        .slice(0, source.max ?? 8);
      result[source.id] = items;
      status[source.id] = { ok: true, count: items.length };
      log(`${source.id}: ${items.length} headlines`);
    } catch (error) {
      result[source.id] = previous[source.id] ?? [];
      status[source.id] = { ok: false, error: String(error.message ?? error) };
      log(`${source.id}: failed (${error.message ?? error}), keeping ${result[source.id].length} cached`);
    }
  }
  return { result, status };
}

function extractTitle(html) {
  const og =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  const title = og?.[1] ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  return title ? cleanTitle(decodeEntities(title)) : null;
}

async function fetchPageTitles(pages, previous) {
  const cache = Object.fromEntries(previous.map((p) => [p.url, p]));
  const result = [];
  for (const page of pages) {
    if (!isHttpUrl(page.url)) continue;
    const cached = cache[page.url];
    let title = cached?.title ?? null;
    if (!title) {
      try {
        title = extractTitle(await fetchText(page.url));
        log(`page title: ${title ?? '(none)'} <- ${page.url}`);
      } catch (error) {
        log(`page ${page.url}: failed (${error.message ?? error})`);
      }
    }
    result.push({
      title,
      url: page.url,
      source: page.source ?? new URL(page.url).hostname,
      date: page.date ? new Date(page.date).toISOString() : null,
    });
  }
  return result;
}

async function fetchCalendars(calendars, previous) {
  const result = {};
  const now = Date.now();
  const horizon = now + CALENDAR_DAYS_AHEAD * 86_400_000;
  for (const cal of calendars) {
    try {
      const data = ical.sync.parseICS(await fetchText(cal.ical));
      const events = Object.values(data)
        .filter((e) => e.type === 'VEVENT' && e.start)
        .map((e) => ({
          date: new Date(e.start).toISOString(),
          end: e.end ? new Date(e.end).toISOString() : null,
          allDay: e.datetype === 'date',
          title: cleanTitle(typeof e.summary === 'object' ? e.summary.val : e.summary),
          organiser: cal.name,
          url: isHttpUrl(e.url?.val ?? e.url) ? (e.url?.val ?? e.url) : cal.homepage,
        }))
        .filter((e) => e.title && Date.parse(e.end ?? e.date) >= now && Date.parse(e.date) <= horizon);
      result[cal.id] = events;
      log(`calendar ${cal.id}: ${events.length} upcoming`);
    } catch (error) {
      result[cal.id] = previous[cal.id] ?? [];
      log(`calendar ${cal.id}: failed (${error.message ?? error}), keeping cache`);
    }
  }
  return result;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const sources = YAML.parse(await readFile(path.join(CONTENT_DIR, 'sources.yaml'), 'utf8')) ?? {};

  const previousNews = await readJson('news.json', { feeds: {}, pages: [] });
  const { result: feeds, status } = await fetchFeeds(sources.feeds ?? [], previousNews.feeds ?? {});
  const pages = await fetchPageTitles(sources.pages ?? [], previousNews.pages ?? []);
  await writeJson('news.json', { feeds, pages });

  const previousCalendars = await readJson('calendars.json', {});
  await writeJson('calendars.json', await fetchCalendars(sources.calendars ?? [], previousCalendars));

  await writeJson('status.json', { fetchedAt: new Date().toISOString(), feeds: status });
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
