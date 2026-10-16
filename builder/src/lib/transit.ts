// Loads the departures computed by scripts/transit.mjs (DATA_DIR/transit.json).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve('.data');

export interface Connection {
  via: string | null;
  busArr?: number;
  line?: string;
  mode?: string;
  dep?: number;
  arr: number;
  dest: string;
  kb?: string;
  kd?: string;
  ka?: string;
}
export interface Departure {
  stop: string;
  line: string;
  mode: string;
  headsign: string;
  t: number;
  k?: string;
  conn?: Connection;
}
export interface TransitData {
  generatedAt: string;
  timetableDate?: string;
  attribution?: string;
  attributionUrl?: string;
  realtime?: { attribution?: string; attributionUrl?: string } | null;
  stops: { name: string; lines: string[]; live: string | null }[];
  departures: Departure[];
}

const file = path.join(DATA_DIR, 'transit.json');
export const transit: TransitData | null = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;

/** Departures in the 24 hours after the build; the browser hides the ones already gone. */
const windowEnd = Date.now() + 24 * 3600_000;
const upcoming = (transit?.departures ?? []).filter((d) => d.t >= Date.now() - 60_000 && d.t <= windowEnd);

export const departuresAt = (stop: string) => upcoming.filter((d) => d.stop === stop);
export const toKoeln = upcoming.filter((d) => d.conn);
export const nextDepartures = upcoming;

export const clock = (ms: number) =>
  new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(ms);
