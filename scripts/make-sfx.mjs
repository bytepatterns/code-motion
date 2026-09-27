/**
 * SFX synthesiser — five styles, zero samples.
 *
 * Every sound effect is synthesised here from raw PCM and written as a 16-bit
 * stereo WAV into public/sfx/<style>/. Nothing is downloaded and ffmpeg is never
 * used to synthesise, so the whole bank is licence-free by construction — and
 * deterministic, so it is rebuilt rather than committed (`npm run sfx`, which
 * also runs on `npm install`).
 *
 * Deliberately NO background music: platform-native trending audio is chosen at
 * upload time (the platform clears the licence and it boosts reach).
 *
 * The bank is PITCHED: compare/swap sounds carry the rank of the bar value, so
 * the set of files to emit is derived from the actual step timelines rather
 * than generated blindly.
 *
 *   npm run sfx              # all styles
 *   npm run sfx -- musical   # one style
 */

import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  PEAK_TARGET,
  SR,
  dbToGain,
  encodeWav,
  gainToDb,
  peakOf,
  rmsOf,
  scale,
  widen,
} from './lib/dsp.mjs';
import {framesFor, writeManifest} from './lib/sfx-manifest.mjs';
import {buildTimeline} from '../src/algorithms/bubbleSort.ts';
import {SFX_STYLES, requiredVariants} from '../src/audio/sfxEvents.ts';
import {REEL_SOURCES, reelVariants} from '../src/timeline/registry.ts';

import musical from './lib/styles/musical.mjs';
import tactile from './lib/styles/tactile.mjs';
import arcade from './lib/styles/arcade.mjs';
import calm from './lib/styles/calm.mjs';
import calmPad from './lib/styles/calm-pad.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SFX_ROOT = join(HERE, '..', 'public', 'sfx');
const FPS = 30;

const STYLES = {musical, tactile, arcade, calm, 'calm-pad': calmPad};

/** Styles in SFX_STYLES without a module in scripts/lib/styles/ are skipped. */
const SYNTH_STYLES = SFX_STYLES.filter((id) => STYLES[id]);

// ------------------------------------------------- which variants do we need?

const timeline = buildTimeline();
/** longest registered scene — the only thing the sustained bed needs to know */
const TOTAL_SEC = Math.max(...REEL_SOURCES.map((r) => r.timeline('calm-pad').total)) / FPS;

/**
 * Every stem ANY registered scene can schedule in this style: the bar sort's
 * pitch-mapped takes plus whatever the other scenes draw from the bank pool.
 * Taking the union is what lets a new scene schedule sound without anyone
 * touching this file.
 */
const variantsFor = (style) =>
  Array.from(
    new Set([
      ...requiredVariants(timeline, style),
      ...REEL_SOURCES.flatMap((r) => reelVariants(r, style)),
    ])
  ).sort();

/** "cmp-3" | "swp-6-2" | "lock" | "final" | "pad" -> a call into the style */
const render = (style, variant) => {
  if (variant === 'lock') return style.lock();
  if (variant === 'final') return style.final();
  if (variant === 'pad') return style.pad(TOTAL_SEC);
  const cmp = /^cmp-(\d+)$/.exec(variant);
  if (cmp) return style.compare(Number(cmp[1]));
  const swp = /^swp-(\d+)-(\d+)$/.exec(variant);
  if (swp) return style.swap(Number(swp[1]), Number(swp[2]));
  throw new Error(`unknown variant "${variant}"`);
};

const KINDS = ['compare', 'swap', 'lock', 'final', 'pad'];

/**
 * Kinds levelled by RMS instead of peak. A sustained bed has a ~3 dB crest
 * factor against a struck note's ~15 dB, so peak-matching the two would put the
 * bed roughly 12 dB too loud; for anything that plays continuously, RMS is the
 * only number that means "how present is this".
 */
const RMS_KINDS = new Set(['pad']);

const kindOf = (variant) =>
  variant === 'lock' || variant === 'final' || variant === 'pad'
    ? variant
    : variant.startsWith('cmp-')
      ? 'compare'
      : 'swap';

// ------------------------------------------------------------------ the build

const manifest = {};
const selected = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const wanted = selected.length ? selected : SYNTH_STYLES;

for (const id of wanted) {
  const style = STYLES[id];
  if (!style) {
    throw new Error(
      SFX_STYLES.includes(id)
        ? `"${id}" has no synthesiser module in scripts/lib/styles/`
        : `unknown style "${id}" (have: ${Object.keys(STYLES).join(', ')})`
    );
  }

  // The variant list is per STYLE, not global: the calm banks skip most
  // compares (see STYLE_RULES in sfxEvents.ts) and calm-pad adds a `pad`, so
  // asking for the default style's list here would both waste files and miss
  // the bed entirely.
  const variants = variantsFor(id);

  // 1. synthesise every variant at its natural relative level
  const built = variants.map((variant) => {
    const raw = render(style, variant);
    return {variant, kind: kindOf(variant), buf: Float64Array.from(raw)};
  });

  // 2. Level per KIND, not per file. Within a kind the files keep exactly the
  //    dynamics they were synthesised with (the humanised pitch/gain jitter,
  //    the shorter ring of the high marimba bars); between kinds the style's
  //    `levels` table decides the balance in dBFS peak. Normalising every file
  //    on its own would flatten the tactile style into the musical one — the
  //    quiet compare IS the design — and one bank-wide gain gives no control
  //    over the compare-vs-finale ratio, which is what sets the integrated
  //    loudness of a sparse SFX track.
  for (const kind of KINDS) {
    const group = built.filter((b) => b.kind === kind);
    if (!group.length) continue;
    const target = dbToGain(style.levels[kind]);
    const measure = RMS_KINDS.has(kind) ? rmsOf : peakOf;
    const groupLevel = Math.max(...group.map((b) => measure(b.buf)));
    for (const b of group) scale(b.buf, target / groupLevel);
  }

  // 3. safety net: nothing may exceed the bank ceiling after balancing. Styles
  //    may lower it (calm uses -10 dBFS) so that summed reverb tails still land
  //    the finished render's true peak under the target.
  const ceiling = style.ceiling === undefined ? PEAK_TARGET : dbToGain(style.ceiling);
  // the bed is a continuous low-level wash; it must never drag the whole bank
  // down just because it is long
  const bankPeak = Math.max(...built.filter((b) => !RMS_KINDS.has(b.kind)).map((b) => peakOf(b.buf)));
  const bankGain = bankPeak > ceiling ? ceiling / bankPeak : 1;

  const dir = join(SFX_ROOT, id);
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(dir, {recursive: true});

  const frames = {};
  let bytes = 0;
  console.log(
    `\n[${id}] ${style.label}  ceiling trim ${gainToDb(bankGain).toFixed(2)} dB  ` +
      `levels ${Object.entries(style.levels)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ')} dBFS`
  );
  for (const {variant, buf} of built) {
    scale(buf, bankGain);
    const right = widen(buf, style.width);
    const {buffer: wav, clipped} = encodeWav(buf, right);
    if (clipped > 0) throw new Error(`${id}/${variant}: ${clipped} samples clipped`);
    writeFileSync(join(dir, `${variant}.wav`), wav);
    bytes += wav.length;

    const durSec = buf.length / SR;
    frames[variant] = framesFor(durSec);
    console.log(
      `  ${variant.padEnd(9)} ${durSec.toFixed(3)}s -> ${String(frames[variant]).padStart(3)}f` +
        `  peak ${gainToDb(peakOf(buf)).toFixed(1)} dBFS  rms ${gainToDb(rmsOf(buf)).toFixed(1)} dBFS`
    );
  }
  manifest[id] = frames;
  console.log(`  ${built.length} files, ${(bytes / 1024).toFixed(0)} KiB -> public/sfx/${id}/`);
}

// -------------------------------------------------------------- TS manifest

writeManifest(manifest);
console.log(`\nwrote src/audio/sfxManifest.ts (${wanted.join(', ')} merged)`);

console.log(`\ndone — ${wanted.join(', ')}`);
