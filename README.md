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

The server needs `compose.yaml` and the `content/` folder; cloning the repository is the
easiest way to get both.

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
| `sources.yaml` | News feeds, single article links (title is read automatically), club calendar feeds |
| `shops.yaml` | Shops with address, phone, owner's link and opening hours (OpenStreetMap syntax) |
| `events.yaml` | Events: date, title, organiser, link to the organiser's announcement |
| `links.yaml` | Link lists: emergency numbers, city services, clubs, social profiles, football club |

Changes are picked up at the next rebuild. To publish right away:

```sh
docker compose restart builder
```

Opening hours use the [OpenStreetMap format](https://wiki.openstreetmap.org/wiki/Key:opening_hours),
for example `Mo-Fr 08:00-12:30,14:30-18:30; Sa 08:00-13:00; Su off`. The "open now" badge is
computed in the visitor's browser in Berlin time.

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
npm test           # opening-hours parser and feed fetcher tests
npm run check      # type checks
```

## Before going live

- [ ] Fill in `content/site.yaml` → `impressum`
- [ ] Confirm the feed URLs in `content/sources.yaml` (watch `docker compose logs builder`)
- [ ] Confirm shop details with the owners and set `checked`
- [ ] Send the courtesy notes in `docs/courtesy-notes.md`
