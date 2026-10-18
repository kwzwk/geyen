import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const script = path.resolve(import.meta.dirname, '../scripts/fetch.mjs');

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>
<item><title>Neuer Kunstrasen in Geyen &amp; mehr</title><link>https://example.org/a</link>
<description>Langer Text, der nicht übernommen werden darf.</description><pubDate>Thu, 15 Oct 2026 10:00:00 +0200</pubDate></item>
<item><title>Ohne Link</title></item>
<item><title>Zweiter Beitrag</title><link>https://example.org/b</link></item>
</channel></rss>`;
const HTML = `<html><head><title>Fallback</title><meta property="og:title" content="Stadt meldet: Platz fertig &#8211; Geyen"></head></html>`;
const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
const ICS = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:1\nDTSTART:${soon}T180000Z\nDTEND:${soon}T200000Z\nSUMMARY:Silvesterfeier\nEND:VEVENT\nBEGIN:VEVENT\nUID:2\nDTSTART:20000101T180000Z\nSUMMARY:Vergangen\nEND:VEVENT\nEND:VCALENDAR\n`;

test('fetch keeps only title, date and link, and survives failures', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/feed') return res.end(RSS);
    if (req.url === '/page') return res.end(HTML);
    if (req.url === '/cal.ics') return res.end(ICS);
    res.statusCode = 500;
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const content = await mkdtemp(path.join(tmpdir(), 'geyen-content-'));
  const data = await mkdtemp(path.join(tmpdir(), 'geyen-data-'));
  await writeFile(
    path.join(content, 'sources.yaml'),
    `feeds:\n  - {id: ok, name: OK, homepage: ${base}/, feed: ${base}/feed}\n  - {id: broken, name: Broken, homepage: ${base}/, feed: ${base}/missing}\n` +
      `pages:\n  - {url: ${base}/page, source: Stadt}\n` +
      `calendars:\n  - {id: cal, name: Verein, homepage: ${base}/, ical: ${base}/cal.ics}\n`,
  );
  const env = { ...process.env, CONTENT_DIR: content, DATA_DIR: data };
  await run(process.execPath, [script], { env });

  const news = JSON.parse(await readFile(path.join(data, 'news.json'), 'utf8'));
  assert.deepEqual(news.feeds.ok, [
    { title: 'Neuer Kunstrasen in Geyen & mehr', url: 'https://example.org/a', date: '2026-10-15T08:00:00.000Z' },
    { title: 'Zweiter Beitrag', url: 'https://example.org/b', date: null },
  ]);
  assert.deepEqual(news.feeds.broken, []);
  assert.equal(news.pages[0].title, 'Stadt meldet: Platz fertig – Geyen');

  const calendars = JSON.parse(await readFile(path.join(data, 'calendars.json'), 'utf8'));
  assert.deepEqual(calendars.cal.map((e) => e.title), ['Silvesterfeier']);

  // A second run where the feed fails must keep the cached headlines.
  server.removeAllListeners('request');
  server.on('request', (_req, res) => {
    res.statusCode = 503;
    res.end();
  });
  await run(process.execPath, [script], { env });
  const cached = JSON.parse(await readFile(path.join(data, 'news.json'), 'utf8'));
  assert.equal(cached.feeds.ok.length, 2);
  const status = JSON.parse(await readFile(path.join(data, 'status.json'), 'utf8'));
  assert.equal(status.feeds.ok.ok, false);
});

test('toHeadline filters by keyword and takes the publisher from aggregator feeds', async () => {
  const { toHeadline } = await import('../scripts/fetch.mjs');
  const regional = { include: ['Pulheim', 'Geyen'] };
  assert.equal(toHeadline({ title: 'Unfall in Bergheim', link: 'https://x.de/1', contentSnippet: 'Bergheim' }, regional), null);
  assert.equal(
    toHeadline({ title: 'Einbruch', link: 'https://x.de/2', contentSnippet: 'In Pulheim-Sinthern …' }, regional).title,
    'Einbruch',
  );
  const google = { sourceFromItem: true };
  assert.deepEqual(
    toHeadline(
      { title: 'Kirmes in Geyen - Kölner Stadt-Anzeiger', link: 'https://news.google.com/a', isoDate: '2026-10-15T08:00:00.000Z', source: { _: 'Kölner Stadt-Anzeiger', $: { url: 'https://www.ksta.de' } } },
      google,
    ),
    { title: 'Kirmes in Geyen', url: 'https://news.google.com/a', date: '2026-10-15T08:00:00.000Z', source: 'Kölner Stadt-Anzeiger' },
  );
  assert.equal(toHeadline({ title: 'Ohne Link' }, {}), null);
});

test('flea market dates are read from the events API once per refresh period', async (t) => {
  let hits = 0;
  const soonDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const server = http.createServer((req, res) => {
    hits++;
    const url = new URL(req.url, 'http://x');
    const page = Number(url.searchParams.get('page'));
    const events =
      page === 1
        ? [
            { id: 7, title: 'Flohmarkt bei Selgros &amp; Co', start_date: `${soonDate} 11:00:00`, end_date: `${soonDate} 18:00:00`, url: 'https://example.org/e/7', venue: { venue: 'Selgros', address: 'Von-Hünefeld-Straße 100', zip: '50829', city: 'Köln' } },
            { id: 8, title: 'Ohne Ort', start_date: `${soonDate} 10:00:00`, url: 'https://example.org/e/8', venue: [] },
          ]
        : [{ id: 9, title: 'Kein Link', start_date: `${soonDate} 10:00:00` }];
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ events, total_pages: 2 }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const content = await mkdtemp(path.join(tmpdir(), 'geyen-content-'));
  const data = await mkdtemp(path.join(tmpdir(), 'geyen-data-'));
  await writeFile(path.join(content, 'sources.yaml'), 'feeds: []\n');
  await writeFile(
    path.join(content, 'activities.yaml'),
    `marketFeed: {name: Kalender, api: ${base}/wp-json/tribe/events/v1/events, search: [Flohmarkt], refreshDays: 7}\n`,
  );
  const env = { ...process.env, CONTENT_DIR: content, DATA_DIR: data };
  await run(process.execPath, [script], { env });

  const markets = JSON.parse(await readFile(path.join(data, 'markets.json'), 'utf8'));
  assert.equal(hits, 2);
  assert.deepEqual(markets.items.map((m) => [m.name, m.town, m.time, m.organiser]), [
    ['Flohmarkt bei Selgros & Co', 'Köln', '11:00–18:00', 'Kalender'],
    ['Ohne Ort', '', '10:00', 'Kalender'],
  ]);

  // Within the refresh period the API is not asked again.
  await run(process.execPath, [script], { env });
  assert.equal(hits, 2);
  assert.equal(JSON.parse(await readFile(path.join(data, 'markets.json'), 'utf8')).items.length, 2);
});
