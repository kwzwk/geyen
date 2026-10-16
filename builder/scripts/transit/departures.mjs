// Turns the trip index into concrete departures from Geyen for the next few days,
// each with the best connection to Köln via a hub (scheduled times). Each time carries a key
// "tripId|stopSequence|serviceDate" that scripts/live.mjs uses to publish real-time delays.

const DAY_MS = 86_400_000;

/** Offset of Europe/Berlin from UTC in ms at the given instant. */
function berlinOffsetMs(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - date.getTime();
}

/** GTFS times count from "noon minus 12 hours" of the service day, in local time. */
export function serviceDayStart(ymd) {
  const y = +ymd.slice(0, 4);
  const m = +ymd.slice(4, 6) - 1;
  const d = +ymd.slice(6, 8);
  const noonUtc = Date.UTC(y, m, d, 12);
  return noonUtc - berlinOffsetMs(new Date(noonUtc)) - 12 * 3600_000;
}

/** Berlin calendar date (YYYYMMDD) of an instant. */
export function berlinDate(ms) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}`;
}

function addDays(ymd, n) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) + n * DAY_MS);
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}

function runsOn(svc, ymd) {
  if (!svc) return false;
  if (svc.remove.includes(ymd)) return false;
  if (svc.add.includes(ymd)) return true;
  if (ymd < svc.start || ymd > svc.end) return false;
  const weekday = (new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).getUTCDay() + 6) % 7;
  return svc.days[weekday] === 1;
}

const MODES = (type) => {
  if (type === 0 || (type >= 900 && type < 1000)) return 'tram';
  if (type === 1 || (type >= 400 && type < 500)) return 'subway';
  if (type === 2 || (type >= 100 && type < 200)) return 'train';
  return 'bus';
};

const liveKey = (tripId, row, ymd) => `${tripId}|${row[0]}|${ymd}`;

export function buildDepartures(index, cfg, now = Date.now()) {
  const { stops, trips, routes, services } = index;
  const today = berlinDate(now);
  const horizon = now + cfg.daysAhead * DAY_MS;
  const dates = [];
  for (let i = -1; i <= cfg.daysAhead; i++) dates.push(addDays(today, i));
  const transferMs = cfg.transferMinutes * 60_000;
  const maxWaitMs = cfg.maxWaitMinutes * 60_000;

  // Onward departures from each hub towards a destination, sorted by time.
  const onward = {};
  for (const [tripId, trip] of Object.entries(trips)) {
    const roles = trip.rows.map((r) => stops[r[1]]);
    const h = roles.findIndex((s) => s.role === 'hub');
    if (h < 0) continue;
    const d = roles.findIndex((s, i) => i > h && s.role === 'dest');
    if (d < 0) continue;
    const route = routes[trip.route] ?? { name: '?', type: 3 };
    for (const ymd of dates) {
      if (!runsOn(services[trip.service], ymd)) continue;
      const base = serviceDayStart(ymd);
      (onward[roles[h].key] ??= []).push({
        dep: base + trip.rows[h][3] * 1000,
        arr: base + trip.rows[d][2] * 1000,
        line: route.name,
        mode: MODES(route.type),
        dest: roles[d].key,
        kd: liveKey(tripId, trip.rows[h], ymd),
        ka: liveKey(tripId, trip.rows[d], ymd),
      });
    }
  }
  for (const list of Object.values(onward)) list.sort((a, b) => a.dep - b.dep);

  const bestConnection = (hubKey, arrival) => {
    let best = null;
    for (const o of onward[hubKey] ?? []) {
      if (o.dep < arrival + transferMs) continue;
      if (o.dep > arrival + maxWaitMs) break;
      if (!best || o.arr < best.arr) best = o;
    }
    return best;
  };

  const departures = [];
  const linesAtStop = {};
  for (const [tripId, trip] of Object.entries(trips)) {
    const route = routes[trip.route] ?? { name: '?', type: 3 };
    trip.rows.forEach((row, i) => {
      const stop = stops[row[1]];
      if (stop.role !== 'geyen' || row[0] >= trip.lastSeq) return; // skip where the trip ends
      (linesAtStop[stop.name] ??= new Set()).add(route.name);
      for (const ymd of dates) {
        if (!runsOn(services[trip.service], ymd)) continue;
        const base = serviceDayStart(ymd);
        const t = base + row[3] * 1000;
        if (t < now - 60_000 || t > horizon) continue;
        let conn = null;
        for (const later of trip.rows.slice(i + 1)) {
          const s = stops[later[1]];
          if (s.role !== 'hub') continue;
          const busArr = base + later[2] * 1000;
          const c = bestConnection(s.key, busArr);
          if (c && (!conn || c.arr < conn.arr)) {
            conn = {
              via: s.key,
              busArr,
              line: c.line,
              mode: c.mode,
              dep: c.dep,
              arr: c.arr,
              dest: c.dest,
              kb: liveKey(tripId, later, ymd),
              kd: c.kd,
              ka: c.ka,
            };
          }
        }
        // A bus that reaches the destination directly also counts.
        const direct = trip.rows.slice(i + 1).find((r) => stops[r[1]].role === 'dest');
        if (direct) {
          const arr = base + direct[2] * 1000;
          if (!conn || arr < conn.arr) conn = { via: null, arr, dest: stops[direct[1]].key, ka: liveKey(tripId, direct, ymd) };
        }
        departures.push({
          stop: stop.name,
          line: route.name,
          mode: MODES(route.type),
          headsign: trip.headsign,
          t,
          k: liveKey(tripId, row, ymd),
          ...(conn ? { conn } : {}),
        });
      }
    });
  }
  departures.sort((a, b) => a.t - b.t || a.line.localeCompare(b.line));

  // The same trip can serve two platforms of one stop name; keep one entry.
  const seen = new Set();
  const unique = departures.filter((d) => {
    const key = `${d.stop}|${d.line}|${d.headsign}|${d.t}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });

  return {
    generatedAt: new Date(now).toISOString(),
    stops: Object.entries(linesAtStop)
      .map(([name, lines]) => ({
        name,
        lines: [...lines].sort((a, b) => a.localeCompare(b, 'de', { numeric: true })),
        live: cfg.stops.liveLinks?.[name] ?? cfg.stops.defaultLiveLink ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    departures: unique,
  };
}
