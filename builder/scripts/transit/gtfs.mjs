// Streaming helpers for reading a GTFS zip without loading it into memory.
import yauzl from 'yauzl';
import readline from 'node:readline';

export function openZip(file) {
  return new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => (err ? reject(err) : resolve(zip))),
  );
}

/** Finds an entry by its base name (feeds sometimes nest files in a folder). */
export async function findEntries(zip) {
  const entries = new Map();
  await new Promise((resolve, reject) => {
    zip.on('entry', (entry) => {
      entries.set(entry.fileName.split('/').pop(), entry);
      zip.readEntry();
    });
    zip.on('end', resolve);
    zip.on('error', reject);
    zip.readEntry();
  });
  return entries;
}

function openStream(zip, entry) {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream))),
  );
}

/** Splits one CSV line, honouring double quotes. GTFS fields never contain line breaks in practice. */
export function parseCsvLine(line) {
  if (!line.includes('"')) return line.split(',');
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

/**
 * Calls onRow(fields, col) for every data row of a GTFS file. `col(name)` returns the
 * column index for a header name (or -1). Missing optional files are skipped.
 */
export async function eachRow(zip, entries, name, onRow) {
  const entry = entries.get(name);
  if (!entry) return false;
  const stream = await openStream(zip, entry);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let col = null;
  for await (const raw of lines) {
    if (header === null) {
      header = parseCsvLine(raw.replace(/^﻿/, '')).map((h) => h.trim());
      const index = new Map(header.map((h, i) => [h, i]));
      col = (n) => index.get(n) ?? -1;
      continue;
    }
    if (raw) onRow(parseCsvLine(raw), col);
  }
  return true;
}

/** "25:10:00" -> seconds after service-day midnight. */
export const toSeconds = (hms) => {
  if (!hms) return null;
  const [h, m, s] = hms.trim().split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
};
