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
