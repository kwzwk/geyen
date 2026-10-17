// Builds a small index of the trips that matter for Geyen from a full GTFS feed:
// every trip serving a Geyen stop, and every trip from a hub (Pulheim Bahnhof,
// Weiden West) to a destination in Köln. Everything else in the feed is skipped.
import { openZip, findEntries, eachRow, toSeconds } from './gtfs.mjs';

const R = 6371;
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const norm = (s) => s.toLowerCase().normalize('NFC');
/** True when the name contains every word of at least one group. */
export const matchesAny = (name, groups) =>
  groups.some((group) => [].concat(group).every((word) => norm(name).includes(norm(String(word)))));
/** A hub or destination matches by one of its exact `names` or by its word groups. */
const matchesPlace = (name, place) =>
  (place.names ?? []).some((n) => norm(n) === norm(name)) || matchesAny(name, place.match ?? []);

export async function buildIndex(zipFile, cfg, log = () => {}) {
  const zip = await openZip(zipFile);
  try {
    const entries = await findEntries(zip);
    const center = cfg.center;

    // 1. Stops: classify Geyen stops, hubs and destinations.
    const stops = {};
    await eachRow(zip, entries, 'stops.txt', (f, col) => {
      const id = f[col('stop_id')];
      const name = f[col('stop_name')];
      const lat = Number(f[col('stop_lat')]);
      const lon = Number(f[col('stop_lon')]);
      if (!id || !name || Number.isNaN(lat)) return;
      const km = distanceKm(center, { lat, lon });
      if (km <= cfg.stops.radiusKm && matchesAny(name, [cfg.stops.match])) {
        stops[id] = { name, role: 'geyen' };
        return;
      }
      if (km > cfg.radiusKm) return;
      const hub = cfg.hubs.find((h) => matchesPlace(name, h));
      if (hub) {
        stops[id] = { name, role: 'hub', key: hub.name };
        return;
      }
      const dest = cfg.destinations.find((d) => matchesPlace(name, d));
      if (dest) stops[id] = { name, role: 'dest', key: dest.name };
    });
    const summary = (role) => [...new Set(Object.values(stops).filter((s) => s.role === role).map((s) => s.name))];
    log(`stops in Geyen: ${summary('geyen').join(', ') || 'none found'}`);
    log(`hubs: ${summary('hub').join(', ') || 'none found'}`);
    log(`destinations: ${summary('dest').join(', ') || 'none found'}`);

    // 2. Stop times: keep rows at those stops, plus the last stop sequence of each such trip.
    const rows = new Map();
    const lastSeq = new Map();
    let currentTrip = null;
    let currentMax = -1;
    const closeTrip = () => {
      if (currentTrip !== null && rows.has(currentTrip)) {
        lastSeq.set(currentTrip, Math.max(lastSeq.get(currentTrip) ?? -1, currentMax));
      }
    };
    let count = 0;
    await eachRow(zip, entries, 'stop_times.txt', (f, col) => {
      const tripId = f[col('trip_id')];
      const seq = Number(f[col('stop_sequence')]);
      if (tripId !== currentTrip) {
        closeTrip();
        currentTrip = tripId;
        currentMax = -1;
      }
      if (seq > currentMax) currentMax = seq;
      const stopId = f[col('stop_id')];
      if (!stops[stopId]) return;
      const arr = toSeconds(f[col('arrival_time')]) ?? toSeconds(f[col('departure_time')]);
      const dep = toSeconds(f[col('departure_time')]) ?? arr;
      if (dep === null) return;
      let list = rows.get(tripId);
      if (!list) rows.set(tripId, (list = []));
      list.push([seq, stopId, arr, dep]);
      if (++count % 1_000_000 === 0) log(`… ${count} matching stop times`);
    });
    closeTrip();

    // 3. Keep trips that serve Geyen, or go from a hub to a destination.
    const trips = {};
    for (const [tripId, list] of rows) {
      list.sort((a, b) => a[0] - b[0]);
      const roles = list.map((r) => stops[r[1]].role);
      const servesGeyen = roles.includes('geyen');
      const hubIndex = roles.indexOf('hub');
      const onward = hubIndex >= 0 && roles.indexOf('dest', hubIndex) > hubIndex;
      if (servesGeyen || onward) trips[tripId] = { rows: list, lastSeq: lastSeq.get(tripId) ?? list.at(-1)[0] };
    }

    // 4. Trips, routes and service calendars for the kept trips.
    const services = {};
    const routes = {};
    await eachRow(zip, entries, 'trips.txt', (f, col) => {
      const trip = trips[f[col('trip_id')]];
      if (!trip) return;
      trip.route = f[col('route_id')];
      trip.service = f[col('service_id')];
      trip.headsign = f[col('trip_headsign')] ?? '';
      routes[trip.route] = null;
      services[trip.service] = { days: [0, 0, 0, 0, 0, 0, 0], start: '00000000', end: '00000000', add: [], remove: [] };
    });
    await eachRow(zip, entries, 'routes.txt', (f, col) => {
      const id = f[col('route_id')];
      if (!(id in routes)) return;
      routes[id] = {
        name: f[col('route_short_name')] || f[col('route_long_name')] || id,
        type: Number(f[col('route_type')]),
      };
    });
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    await eachRow(zip, entries, 'calendar.txt', (f, col) => {
      const svc = services[f[col('service_id')]];
      if (!svc) return;
      svc.days = days.map((d) => Number(f[col(d)]) || 0);
      svc.start = f[col('start_date')];
      svc.end = f[col('end_date')];
    });
    await eachRow(zip, entries, 'calendar_dates.txt', (f, col) => {
      const svc = services[f[col('service_id')]];
      if (!svc) return;
      (f[col('exception_type')] === '1' ? svc.add : svc.remove).push(f[col('date')]);
    });

    const usedStops = {};
    for (const trip of Object.values(trips)) for (const r of trip.rows) usedStops[r[1]] = stops[r[1]];
    log(`kept ${Object.keys(trips).length} trips on ${Object.keys(routes).length} lines`);
    return { stops: usedStops, trips, routes, services };
  } finally {
    zip.close();
  }
}
