// Polls the gtfs.de GTFS-Realtime feed and publishes delays and cancellations for the trips in
// the timetable index as SITE_DIR/live/transit.json, which the bus page reads every minute.
// Runs as a long-lived process next to the build loop (see run.sh).
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import protobuf from 'protobufjs';
import YAML from 'yaml';
import { berlinDate, serviceDayStart } from './transit/departures.mjs';

const CONTENT_DIR = process.env.CONTENT_DIR ?? path.resolve('../content');
const DATA_DIR = process.env.DATA_DIR ?? path.resolve('.data');
const SITE_DIR = process.env.SITE_DIR ?? path.resolve('.site');
const INDEX_FILE = path.join(DATA_DIR, 'transit-index.json');
const OUT_DIR = path.join(SITE_DIR, 'live');
const USER_AGENT = process.env.USER_AGENT ?? 'geyen.org departures (+https://geyen.org)';

const log = (...args) => console.log(new Date().toISOString(), '[live]', ...args);

// The parts of gtfs-realtime.proto this script reads; unknown fields are skipped when decoding.
const PROTO = `
syntax = "proto2";
message FeedMessage { required FeedHeader header = 1; repeated FeedEntity entity = 2; }
message FeedHeader { required string gtfs_realtime_version = 1; optional uint64 timestamp = 3; }
message FeedEntity { required string id = 1; optional TripUpdate trip_update = 3; }
message TripUpdate {
  required TripDescriptor trip = 1;
  repeated StopTimeUpdate stop_time_update = 2;
  optional int32 delay = 5;
}
message TripDescriptor {
  optional string trip_id = 1;
  optional string start_date = 3;
  optional int32 schedule_relationship = 4;
}
message StopTimeUpdate {
  optional uint32 stop_sequence = 1;
  optional StopTimeEvent arrival = 2;
  optional StopTimeEvent departure = 3;
  optional string stop_id = 4;
  optional int32 schedule_relationship = 5;
}
message StopTimeEvent { optional int32 delay = 1; optional int64 time = 2; }
`;
export const FeedMessage = protobuf.parse(PROTO).root.lookupType('FeedMessage');

const TRIP_CANCELED = 3;
const STOP_SKIPPED = 1;
// A bus or train is never hours early or a day late. A delay outside this range means the feed's
// trip id now names a different trip than our timetable index (for example after the feed moved to
// a newer timetable), and applying it would hide or shift departures that are still to come.
const MAX_EARLY_S = 15 * 60;
const MAX_LATE_S = 6 * 3600;
const plausible = (delay) => (delay !== null && delay >= -MAX_EARLY_S && delay <= MAX_LATE_S ? delay : null);

/**
 * Delays per live key "tripId|stopSequence|serviceDate" for the trips in the index:
 * seconds late (negative when early), or "x" when the trip is cancelled or the stop skipped.
 * A delay applies to later stops until the next update, as the GTFS-Realtime spec says.
 */
export function delaysFor(feed, index, now = Date.now()) {
  const out = {};
  const today = berlinDate(now);
  for (const entity of feed.entity ?? []) {
    const update = entity.trip_update ?? entity.tripUpdate;
    const tripId = update?.trip?.trip_id ?? update?.trip?.tripId;
    const trip = tripId && index.trips[tripId];
    if (!trip) continue;
    const ymd = update.trip.start_date ?? update.trip.startDate ?? today;
    const relationship = update.trip.schedule_relationship ?? update.trip.scheduleRelationship;
    if (relationship === TRIP_CANCELED) {
      for (const row of trip.rows) out[`${tripId}|${row[0]}|${ymd}`] = 'x';
      continue;
    }
    // Place each update on a stop sequence; updates naming only a stop outside the index can't be placed.
    const rowBySeq = Object.fromEntries(trip.rows.map((r) => [r[0], r]));
    const seqOfStop = Object.fromEntries(trip.rows.map((r) => [r[1], r[0]]));
    const updates = (update.stop_time_update ?? update.stopTimeUpdate ?? [])
      .map((u) => {
        const seq = u.stop_sequence ?? u.stopSequence ?? seqOfStop[u.stop_id ?? u.stopId];
        const row = rowBySeq[seq];
        const delay = plausible(eventDelay(u.departure, row?.[3], ymd) ?? eventDelay(u.arrival, row?.[2], ymd));
        return { seq, delay, skipped: (u.schedule_relationship ?? u.scheduleRelationship) === STOP_SKIPPED };
      })
      .filter((u) => u.seq !== undefined)
      .sort((a, b) => a.seq - b.seq);
    for (const [seq] of trip.rows) {
      const key = `${tripId}|${seq}|${ymd}`;
      if (updates.some((u) => u.seq === seq && u.skipped)) {
        out[key] = 'x';
        continue;
      }
      const delay = updates.filter((u) => u.seq <= seq && u.delay !== null).at(-1)?.delay ?? plausible(update.delay ?? null);
      if (delay !== null) out[key] = delay;
    }
  }
  return out;
}

// Delay of a stop time event in seconds. An event with only an absolute time is compared with the
// scheduled time, which is known only for stops in the index.
function eventDelay(event, scheduledSec, ymd) {
  if (!event) return null;
  if (event.delay !== null && event.delay !== undefined) return Number(event.delay);
  if (event.time && typeof scheduledSec === 'number') {
    return Math.round(Number(event.time) - (serviceDayStart(ymd) / 1000 + scheduledSec));
  }
  return null;
}

async function loadConfig() {
  const cfg = YAML.parse(await readFile(path.join(CONTENT_DIR, 'transit.yaml'), 'utf8')) ?? {};
  return { enabled: false, intervalSeconds: 120, quietHours: [1, 4], ...(cfg.realtime ?? {}) };
}

async function writeLive(data) {
  await mkdir(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, 'transit.json');
  await writeFile(`${target}.tmp`, JSON.stringify(data));
  await rename(`${target}.tmp`, target);
}

const berlinHour = (ms) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(ms));

async function main() {
  let index = null;
  let indexMtime = 0;
  let lastModified = null;
  for (;;) {
    const cfg = await loadConfig().catch(() => ({ enabled: false, intervalSeconds: 600 }));
    const [quietFrom, quietTo] = cfg.quietHours ?? [];
    const hour = berlinHour(Date.now());
    const quiet = quietFrom !== undefined && hour >= quietFrom && hour < quietTo;
    if (cfg.enabled && cfg.url && !quiet) {
      try {
        const mtime = (await stat(INDEX_FILE)).mtimeMs;
        if (mtime !== indexMtime) {
          index = JSON.parse(await readFile(INDEX_FILE, 'utf8'));
          indexMtime = mtime;
          log(`loaded timetable index with ${Object.keys(index.trips).length} trips`);
        }
        const res = await fetch(cfg.url, {
          headers: { 'user-agent': USER_AGENT, ...(lastModified ? { 'if-modified-since': lastModified } : {}) },
          signal: AbortSignal.timeout(60_000),
        });
        if (res.status === 200) {
          lastModified = res.headers.get('last-modified');
          const buffer = new Uint8Array(await res.arrayBuffer());
          const feed = FeedMessage.toObject(FeedMessage.decode(buffer), { longs: Number });
          const delays = delaysFor(feed, index);
          await writeLive({
            generatedAt: new Date().toISOString(),
            feedTime: feed.header?.timestamp ? new Date(feed.header.timestamp * 1000).toISOString() : null,
            attribution: cfg.attribution ?? null,
            attributionUrl: cfg.attributionUrl ?? null,
            delays,
          });
          log(`${(buffer.length / 1e6).toFixed(1)} MB, ${Object.keys(delays).length} live times for Geyen`);
        } else if (res.status !== 304) {
          log(`feed answered HTTP ${res.status}`);
        }
      } catch (error) {
        log(`failed: ${error.message ?? error}`);
      }
    }
    await new Promise((r) => setTimeout(r, Math.max(30, cfg.intervalSeconds ?? 120) * 1000));
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) main();
