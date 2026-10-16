import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yazl from 'yazl';
import { buildIndex } from '../scripts/transit/index.mjs';
import { buildDepartures, serviceDayStart } from '../scripts/transit/departures.mjs';

const FILES = {
  'stops.txt': `stop_id,stop_name,stop_lat,stop_lon
G1,Geyen Mitte,50.9817,6.7864
G2,"Geyen, Von-Frentz-Str.",50.9830,6.7880
P1,Pulheim Bahnhof,50.9990,6.8050
W1,Köln-Weiden West,50.9430,6.8300
H1,Köln Hbf,50.9430,6.9580
N1,Köln Neumarkt,50.9360,6.9470
FAR,Geyen Nord,52.0000,8.0000
`,
  'routes.txt': `route_id,route_short_name,route_long_name,route_type
R980,980,,3
RB27,RB 27,,2
T1,1,,0
`,
  'trips.txt': `route_id,service_id,trip_id,trip_headsign
R980,ALL,b1,Pulheim Bahnhof
R980,ALL,b2,Geyen Mitte
RB27,ALL,r1,Köln Hbf
RB27,ALL,r2,Köln Hbf
RB27,WEEKEND,r3,Köln Hbf
T1,ALL,t1,Bensberg
`,
  'stop_times.txt': `trip_id,arrival_time,departure_time,stop_id,stop_sequence
b1,08:00:00,08:00:00,G1,1
b1,08:02:00,08:02:00,G2,2
b1,08:05:00,08:05:00,ZZ,3
b1,08:10:00,08:10:00,P1,4
b2,09:00:00,09:00:00,P1,1
b2,09:08:00,09:08:00,G2,2
b2,09:10:00,09:10:00,G1,3
r1,08:12:00,08:12:00,P1,1
r1,08:30:00,08:30:00,H1,2
r2,08:20:00,08:20:00,P1,1
r2,08:38:00,08:38:00,H1,2
r3,08:15:00,08:15:00,P1,1
r3,08:33:00,08:33:00,H1,2
t1,08:00:00,08:00:00,W1,1
t1,08:30:00,08:30:00,N1,2
`,
  'calendar.txt': `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
ALL,1,1,1,1,1,1,1,20260101,20271231
WEEKEND,0,0,0,0,0,1,1,20260101,20271231
`,
  'calendar_dates.txt': `service_id,date,exception_type
ALL,20261017,2
`,
};

const CFG = {
  center: { lat: 50.9817, lon: 6.7864 },
  stops: { match: ['geyen'], radiusKm: 2, liveLinks: { 'Geyen Mitte': 'https://example.org/live' } },
  hubs: [
    { name: 'Pulheim Bahnhof', match: [['pulheim', 'bahnhof'], ['pulheim', 'bf']] },
    { name: 'Köln-Weiden West', match: [['weiden', 'west']] },
  ],
  destinations: [
    { name: 'Köln Hbf', match: [['köln', 'hbf']] },
    { name: 'Köln Neumarkt', match: [['köln', 'neumarkt']] },
  ],
  radiusKm: 30,
  daysAhead: 1,
  transferMinutes: 4,
  maxWaitMinutes: 60,
};

async function makeZip() {
  const dir = await mkdtemp(path.join(tmpdir(), 'geyen-gtfs-'));
  const file = path.join(dir, 'gtfs.zip');
  const zip = new yazl.ZipFile();
  for (const [name, body] of Object.entries(FILES)) zip.addBuffer(Buffer.from(body), name);
  zip.end();
  await new Promise((resolve) => zip.outputStream.pipe(createWriteStream(file)).on('close', resolve));
  return file;
}

const clock = (ms) =>
  new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(ms);

test('index keeps Geyen trips and hub-to-Köln trips only', async () => {
  const index = await buildIndex(await makeZip(), CFG);
  assert.deepEqual(Object.keys(index.trips).sort(), ['b1', 'b2', 'r1', 'r2', 'r3', 't1']);
  assert.equal(index.stops.FAR, undefined);
  assert.equal(index.trips.b2.lastSeq, 3);
  assert.equal(index.routes.RB27.name, 'RB 27');
  assert.deepEqual(index.services.ALL.remove, ['20261017']);
});

test('departures with connections to Köln', async () => {
  const index = await buildIndex(await makeZip(), CFG);
  // Friday 2026-10-16, 07:00 in Berlin.
  const now = Date.parse('2026-10-16T05:00:00Z');
  const result = buildDepartures(index, CFG, now);
  const friday = result.departures.filter((d) => d.t < Date.parse('2026-10-16T22:00:00Z'));

  assert.deepEqual(
    friday.map((d) => [d.stop, d.line, clock(d.t)]),
    [
      ['Geyen Mitte', '980', '08:00'],
      ['Geyen, Von-Frentz-Str.', '980', '08:02'],
      ['Geyen, Von-Frentz-Str.', '980', '09:08'],
    ],
    'the 09:10 arrival at Geyen Mitte ends there and is not a departure',
  );
  const conn = friday[0].conn;
  assert.equal(conn.via, 'Pulheim Bahnhof');
  assert.equal(conn.line, 'RB 27');
  assert.equal(clock(conn.busArr), '08:10');
  assert.equal(clock(conn.dep), '08:20', 'the 08:12 train is inside the 4-minute transfer time; r3 runs weekends only');
  assert.equal(clock(conn.arr), '08:38');
  assert.equal(conn.dest, 'Köln Hbf');
  assert.equal(friday[2].conn, undefined);
  assert.equal(friday[0].k, 'b1|1|20261016');
  assert.equal(conn.kb, 'b1|4|20261016');
  assert.match(conn.kd, /^r\d\|\d+\|20261016$/);

  // Saturday 2026-10-17: service ALL is removed by calendar_dates, so no departures that day.
  const saturday = result.departures.filter((d) => d.t >= Date.parse('2026-10-16T22:00:00Z'));
  assert.equal(saturday.length, 0);

  assert.deepEqual(result.stops, [
    { name: 'Geyen Mitte', lines: ['980'], live: 'https://example.org/live' },
    { name: 'Geyen, Von-Frentz-Str.', lines: ['980'], live: null },
  ]);
});

test('live delays are matched to timetable keys and carried to later stops', async () => {
  const { FeedMessage, delaysFor } = await import('../scripts/live.mjs');
  const index = await buildIndex(await makeZip(), CFG);
  const now = Date.parse('2026-10-16T05:00:00Z');
  const conn = buildDepartures(index, CFG, now).departures[0].conn;
  const train = conn.kd.split('|')[0];
  const at0802 = Math.floor(Date.parse('2026-10-16T06:02:00Z') / 1000);
  const bytes = FeedMessage.encode(
    FeedMessage.fromObject({
      header: { gtfsRealtimeVersion: '2.0', timestamp: Math.floor(now / 1000) },
      entity: [
        { id: '1', tripUpdate: { trip: { tripId: 'b1', startDate: '20261016' }, stopTimeUpdate: [{ stopSequence: 2, departure: { time: at0802 + 180 } }] } },
        { id: '2', tripUpdate: { trip: { tripId: train, startDate: '20261016', scheduleRelationship: 3 } } },
        { id: '3', tripUpdate: { trip: { tripId: 'elsewhere', startDate: '20261016' }, delay: 60 } },
      ],
    }),
  ).finish();
  const feed = FeedMessage.toObject(FeedMessage.decode(bytes), { longs: Number });
  const delays = delaysFor(feed, index, now);

  assert.equal(delays['b1|1|20261016'], undefined, 'no update before stop 2');
  assert.equal(delays['b1|2|20261016'], 180, 'absolute time compared with the schedule');
  assert.equal(delays['b1|4|20261016'], 180, 'and carried to later stops');
  assert.equal(delays[conn.kd], 'x', 'cancelled train');
  assert.ok(!Object.keys(delays).some((k) => k.startsWith('elsewhere')));

  const withDelay = FeedMessage.toObject(
    FeedMessage.decode(
      FeedMessage.encode(
        FeedMessage.fromObject({
          header: { gtfsRealtimeVersion: '2.0' },
          entity: [{ id: '1', tripUpdate: { trip: { tripId: 'b1', startDate: '20261016' }, stopTimeUpdate: [{ stopSequence: 2, departure: { delay: 240 } }] } }],
        }),
      ).finish(),
    ),
    { longs: Number },
  );
  const carried = delaysFor(withDelay, index, now);
  assert.equal(carried['b1|2|20261016'], 240);
  assert.equal(carried['b1|4|20261016'], 240, 'a delay applies to later stops');
});

test('service day start follows daylight saving time', () => {
  // 2026-10-25 is the switch from CEST to CET; GTFS times count from noon minus 12 h.
  assert.equal(new Date(serviceDayStart('20261024')).toISOString(), '2026-10-23T22:00:00.000Z');
  assert.equal(new Date(serviceDayStart('20261026')).toISOString(), '2026-10-25T23:00:00.000Z');
});
