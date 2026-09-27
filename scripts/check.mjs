/**
 * Both gates over every rendered scene:
 *   verify-layout  no content pixel outside the safe zone, on any frame
 *   verify-sound   loudness band, true peak, a/v sync, every event audible,
 *                  no clipping — against DEFAULT_STYLE's targets
 *
 *   npm run check                      # every scene with an out/<outFile>.mp4
 *   npm run check -- BreadthFirstSearch   # one scene (id, alias or file stem)
 *
 * Exits non-zero if any gate fails, or if a scene named on the command line has
 * not been rendered.
 */
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {DEFAULT_STYLE} from '../src/audio/sfxEvents.ts';
import {REEL_SOURCES, reelSource} from '../src/timeline/registry.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const picked = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = picked.length ? picked.map(reelSource) : REEL_SOURCES;

const node = (args) => spawnSync(process.execPath, args, {cwd: ROOT, stdio: 'inherit'}).status === 0;

const failed = [];
let checked = 0;
for (const r of targets) {
  const mp4 = join('out', `${r.outFile}.mp4`);
  if (!existsSync(join(ROOT, mp4))) {
    if (picked.length) failed.push(`${r.compositionId}: ${mp4} not rendered`);
    else console.log(`skip  ${r.compositionId} — ${mp4} not rendered`);
    continue;
  }
  checked++;
  console.log(`\n##### ${r.compositionId} — layout`);
  if (!node(['scripts/verify-layout.mjs', mp4])) failed.push(`${r.compositionId}: layout`);
  console.log(`\n##### ${r.compositionId} — sound (${DEFAULT_STYLE})`);
  const sound = node([
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    '--import',
    './scripts/lib/ts-register.mjs',
    'scripts/verify-sound.mjs',
    DEFAULT_STYLE,
    mp4,
    r.compositionId,
  ]);
  if (!sound) failed.push(`${r.compositionId}: sound`);
}

console.log(`\n${checked} scene(s) checked`);
if (failed.length) {
  console.error(`FAILED\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
if (checked === 0) {
  console.error('nothing rendered yet — run npm run render:all first');
  process.exit(1);
}
console.log('ALL GATES PASSED');
