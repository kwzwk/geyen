#!/bin/sh
# Builder loop: fetch sources, build the site into a new release folder, then switch
# the "current" symlink atomically so nginx never serves a half-written site.
set -u

INTERVAL="${REBUILD_INTERVAL_SECONDS:-1800}"
SITE_DIR="${SITE_DIR:-/site}"
DATA_DIR="${DATA_DIR:-/data}"
KEEP_RELEASES=3

# Use the mounted content folder when it has the site files, otherwise the copy bundled in the image.
if [ ! -f "${CONTENT_DIR:-/content}/site.yaml" ] && [ -d /app/content-default ]; then
  echo "$(date -Iseconds) [run] no site.yaml in ${CONTENT_DIR:-/content}, using the content bundled in the image"
  export CONTENT_DIR=/app/content-default
fi
echo "$(date -Iseconds) [run] content from $CONTENT_DIR"

mkdir -p "$SITE_DIR/releases"

# Real-time delays for the bus page, refreshed every few minutes next to the build loop.
(while true; do node scripts/live.mjs; echo "$(date -Iseconds) [run] live updates stopped, restarting"; sleep 60; done) &

while true; do
  echo "$(date -Iseconds) [run] fetching sources"
  node scripts/fetch.mjs || echo "$(date -Iseconds) [run] fetch failed, building with cached data"
  node scripts/transit.mjs departures || echo "$(date -Iseconds) [run] departures failed, building without them"

  name="$(date +%Y%m%d-%H%M%S)"
  release="$SITE_DIR/releases/$name"
  # Build inside the container first (Astro moves files around and needs one filesystem),
  # then copy the finished site into the shared volume.
  rm -rf dist
  if node_modules/.bin/astro build --silent && cp -R dist "$release"; then
    node scripts/publish.mjs "$SITE_DIR" "$name" "$KEEP_RELEASES"
    echo "$(date -Iseconds) [run] published release $name"
  else
    echo "$(date -Iseconds) [run] build failed, keeping the previous release"
    rm -rf "$release"
  fi

  # The timetable (several hundred MB) is refreshed after publishing, so the site is never held up by it.
  # When a new index was built, rebuild right away instead of waiting.
  before="$(stat -c %Y "$DATA_DIR/transit-index.json" 2>/dev/null || echo 0)"
  node scripts/transit.mjs || echo "$(date -Iseconds) [run] timetable refresh failed, keeping the previous one"
  after="$(stat -c %Y "$DATA_DIR/transit-index.json" 2>/dev/null || echo 0)"
  [ "$before" != "$after" ] && continue

  sleep "$INTERVAL"
done
