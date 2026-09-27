/**
 * Renders the middle frame of every scene to docs/stills/<outFile>.png at half
 * resolution — the images the README shows, and the frame a reviewer (human
 * or agent) looks at before calling a scene done.
 *
 *   npm run stills                      # every scene
 *   npm run stills -- BinarySearch      # one scene (id, alias or file stem)
 */
import {mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {DEFAULT_STYLE} from '../src/audio/sfxEvents.ts';
import {REEL_SOURCES, reelSource} from '../src/timeline/registry.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const picked = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = picked.length ? picked.map(reelSource) : REEL_SOURCES;

mkdirSync(join(ROOT, 'docs', 'stills'), {recursive: true});
for (const r of targets) {
  const frame = Math.floor(r.timeline(DEFAULT_STYLE).total / 2);
  const out = `docs/stills/${r.outFile}.png`;
  console.log(`${r.compositionId} frame ${frame} -> ${out}`);
  const res = spawnSync(
    'npx',
    ['remotion', 'still', r.compositionId, out, `--frame=${frame}`, '--scale=0.5'],
    {cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32'}
  );
  if (res.status !== 0) process.exit(res.status ?? 1);
}
