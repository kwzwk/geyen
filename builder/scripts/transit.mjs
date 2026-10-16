// Timetable step of the builder:
//   node scripts/transit.mjs            -> refresh the trip index if it is missing or older than refreshDays
//   node scripts/transit.mjs --force    -> refresh the trip index now
//   node scripts/transit.mjs departures -> write DATA_DIR/transit.json for the next days (fast, runs every build)
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import YAML from 'yaml';
import { buildIndex } from './transit/index.mjs';
import { buildDepartures } from './transit/departures.mjs';

const CONTENT_DIR = process.env.CONTENT_DIR ?? path.resolve('../content');
const DATA_DIR = process.env.DATA_DIR ?? path.resolve('.data');
const USER_AGENT = process.env.USER_AGENT ?? 'geyen.org timetable (+https://geyen.org)';
const INDEX_FILE = path.join(DATA_DIR, 'transit-index.json');
const log = (...a) => console.log(new Date().toISOString(), '[transit]', ...a);

async function writeJson(file, data) {
  await writeFile(`${file}.tmp`, JSON.stringify(data));
  await rename(`${file}.tmp`, file);
}

async function loadConfig() {
  const file = path.join(CONTENT_DIR, 'transit.yaml');
  try {
    return YAML.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function readIndex() {
  try {
    return JSON.parse(await readFile(INDEX_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function refreshIndex(cfg, force) {
  const current = await readIndex();
  const ageDays = current ? (Date.now() - Date.parse(current.builtAt)) / 86_400_000 : Infinity;
  if (!force && current?.source?.url === cfg.gtfsUrl && ageDays < cfg.refreshDays) {
    log(`index is ${ageDays.toFixed(1)} days old, no refresh needed`);
    return;
  }
  const headers = { 'user-agent': USER_AGENT };
  if (!force && current?.source?.url === cfg.gtfsUrl && current.source.lastModified) {
    headers['if-modified-since'] = current.source.lastModified;
  }
  log(`downloading ${cfg.gtfsUrl}`);
  const res = await fetch(cfg.gtfsUrl, { headers, signal: AbortSignal.timeout(30 * 60_000) });
  if (res.status === 304 && current) {
    log('timetable unchanged');
    await writeJson(INDEX_FILE, { ...current, builtAt: new Date().toISOString() });
    return;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const zipFile = path.join(DATA_DIR, 'gtfs.zip');
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zipFile));
  log(`downloaded ${((await stat(zipFile)).size / 1e6).toFixed(0)} MB, building index`);
  try {
    const index = await buildIndex(zipFile, cfg, log);
    await writeJson(INDEX_FILE, {
      builtAt: new Date().toISOString(),
      source: { url: cfg.gtfsUrl, lastModified: res.headers.get('last-modified') },
      ...index,
    });
    log('index written');
  } finally {
    await rm(zipFile, { force: true });
  }
}

async function writeDepartures(cfg) {
  const index = await readIndex();
  if (!index) {
    log('no timetable index yet, skipping departures');
    return;
  }
  const result = buildDepartures(index, cfg);
  await writeJson(path.join(DATA_DIR, 'transit.json'), {
    ...result,
    attribution: cfg.attribution,
    attributionUrl: cfg.attributionUrl,
    timetableDate: index.source?.lastModified ?? index.builtAt,
  });
  log(`${result.departures.length} departures from ${result.stops.length} stops`);
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const cfg = await loadConfig();
  if (!cfg) {
    log('content/transit.yaml missing, timetable disabled');
    return;
  }
  const args = process.argv.slice(2);
  if (args[0] === 'departures') await writeDepartures(cfg);
  else await refreshIndex(cfg, args.includes('--force'));
}

main().catch((error) => {
  console.error(new Date().toISOString(), '[transit] failed:', error.message ?? error);
  process.exit(1);
});
