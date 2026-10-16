# geyen.org

Community website for Geyen (Pulheim). The site only shows headlines, dates and facts, and
every item links to the source that published it. No texts or images are copied.

German is the main language; navigation and interface labels are also available in English
under `/en/`.

## How it works

Two containers, published to GitHub Container Registry for amd64 and arm64:

| Image | What it does |
| --- | --- |
| `ghcr.io/kwzwk/geyen-builder` | Every 30 minutes: reads the RSS and calendar feeds listed in `content/sources.yaml`, then builds the static site with [Astro](https://astro.build) and publishes it to a shared volume. A source that fails keeps its last good headlines. |
| `ghcr.io/kwzwk/geyen-web` | Unprivileged nginx serving the built site on port 8080, with a strict Content-Security-Policy. Your reverse proxy terminates TLS and forwards to it. |

The site loads no third-party scripts, fonts, embeds or trackers and sets no cookies, so no
cookie banner is needed.

## Run it

The server only needs `compose.yaml`; the builder image carries a copy of `content/`.
Cloning the repository is still the easiest way to edit the content on the server: a
`content/` folder next to `compose.yaml` replaces the bundled copy (an empty one is ignored).

```sh
git clone https://github.com/kwzwk/geyen.git && cd geyen
cp .env.example .env    # optional: change port, bind address or image version
docker compose up -d
```

The web container waits until the first build is published, then answers on
`127.0.0.1:8080`. Point your reverse proxy there. If the proxy runs on another machine,
set `WEB_BIND=0.0.0.0` in `.env`. A health endpoint is available at `/healthz`.

Update to the newest images:

```sh
git pull && docker compose pull && docker compose up -d
```

To build the images from your checkout instead of pulling them:

```sh
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

### Image tags

| Tag | When it is published |
| --- | --- |
| `latest` | Every push to `main` |
| `1.2.3`, `1.2` | When a tag such as `v1.2.3` is pushed |
| `sha-abc1234` | Every published build, for pinning or rollback |

Set `GEYEN_VERSION` in `.env` to pin a version.

## Editing content

Everything you edit lives in `content/`:

| File | Contents |
| --- | --- |
| `site.yaml` | Impressum details (**fill in before going live**), log retention, highlight keywords |
| `sources.yaml` | News feeds (optionally filtered by place names), single article links (title is read automatically), club calendar feeds |
| `shops.yaml` | Shops with address, phone, owner's link and opening hours (OpenStreetMap syntax) |
| `events.yaml` | Events: date, title, organiser, link to the organiser's announcement |
| `links.yaml` | Link lists: emergency numbers, city services, clubs, social profiles, football club, journey planners |
| `transit.yaml` | Timetable source, which stops count as Geyen, the transfer hubs (Pulheim Bahnhof, Köln-Weiden West) and the Köln destinations |

Changes are picked up at the next rebuild. To publish right away:

```sh
docker compose restart builder
```

Opening hours use the [OpenStreetMap format](https://wiki.openstreetmap.org/wiki/Key:opening_hours),
for example `Mo-Fr 08:00-12:30,14:30-18:30; Sa 08:00-13:00; Su off`. The "open now" badge is
computed in the visitor's browser in Berlin time.

## Bus & Bahn

The `/verkehr/` page and the "Nächste Busse" card on the home page show scheduled departures
from the Geyen stops and the best connection into Köln, changing either at Pulheim Bahnhof or
at Köln-Weiden West (at least 4 minutes to change, at most 60 minutes of waiting).

- Data: the German local transport timetable from [gtfs.de](https://gtfs.de) (DELFI e.V.,
  CC BY 4.0, credited on the page). The builder downloads it (about 270 MB) once a day,
  keeps a small index of the trips that matter in the data volume and deletes the download.
- Real time: every 2 minutes the builder reads the [gtfs.de real-time feed](https://gtfs.de/de/realtime/)
  (CC BY-SA 4.0, credited on the page; several MB per request, paused 1–4 am) and writes the
  delays and cancellations for Geyen to `/live/transit.json`. The page loads that file from
  your own server every minute and shows "+3", "pünktlich", "fällt aus" or "Anschluss gefährdet".
  Trips the operators don't report keep their scheduled time. Turn it off with
  `realtime.enabled: false` in `content/transit.yaml`.
- Stops are found by name and distance (`content/transit.yaml`). After the first start,
  `docker compose logs builder` lists the stops, hubs and destinations it matched; adjust the
  name tokens there if something is missing.
- To refresh the timetable right away: `docker compose exec builder node scripts/transit.mjs --force`.

## Content rules

- Headlines are shown exactly as published, with source and date, linking to the original.
- No teaser text, images or full articles from other sites.
- Instagram and Facebook are linked, never embedded.
- Shop data should be confirmed by the owner; set `checked` to the date they confirmed.

Draft emails to notify each source are in [`docs/courtesy-notes.md`](docs/courtesy-notes.md).

## Develop locally

```sh
cd builder
npm install
npm run fetch      # writes builder/.data/*.json
npm run dev        # http://localhost:4321
npm run transit    # optional: downloads the timetable (about 270 MB) and builds .data/transit-index.json
npm test           # opening-hours parser, feed fetcher and timetable tests
npm run check      # type checks
```

## Before going live

- [ ] Fill in `content/site.yaml` → `impressum`
- [ ] Confirm the feed URLs in `content/sources.yaml` (watch `docker compose logs builder`)
- [ ] Check the matched bus stops in `docker compose logs builder` (see Bus & Bahn)
- [ ] Confirm shop details with the owners and set `checked`
- [ ] Send the courtesy notes in `docs/courtesy-notes.md`
