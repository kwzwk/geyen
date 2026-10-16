// Points SITE_DIR/current at the new release (atomic rename of a symlink)
// and deletes all but the newest releases.
import { symlinkSync, renameSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const [siteDir, name, keep = '3'] = process.argv.slice(2);
const tmp = path.join(siteDir, `current.${process.pid}`);
symlinkSync(path.join('releases', name), tmp);
renameSync(tmp, path.join(siteDir, 'current'));

const releases = readdirSync(path.join(siteDir, 'releases')).sort();
for (const old of releases.slice(0, Math.max(0, releases.length - Number(keep)))) {
  if (old !== name) rmSync(path.join(siteDir, 'releases', old), { recursive: true, force: true });
}
