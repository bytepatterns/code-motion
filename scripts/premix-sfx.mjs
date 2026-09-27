/**
 * Offline premix — renders the SFX-only mix for a style straight to a WAV so it
 * can be metered (LUFS / peak / onsets) WITHOUT paying for a full Remotion
 * video render. It reproduces exactly what <SfxTrack> does: for every scheduled
 * event, sum the variant WAV in at `frame`, scaled by the event volume, cut off
 * at the sequence length from the generated manifest.
 *
 *   node --import ./scripts/lib/ts-register.mjs scripts/premix-sfx.mjs musical
 *
 * Output: out/premix-<style>.wav  (stereo, 44.1 kHz, 16-bit)
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {SR, decodeWav, encodeWav, gainToDb, peakOf, rmsOf} from './lib/dsp.mjs';
import {SFX_STYLES} from '../src/audio/sfxEvents.ts';
import {SFX_FRAMES} from '../src/audio/sfxManifest.ts';
import {reelSfxEvents, reelSource} from '../src/timeline/registry.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'out');
const SFX_ROOT = join(HERE, '..', 'public', 'sfx');
const FPS = 30;

/**
 * The synth banks are written at SR (44.1 kHz). A bank at another rate (say,
 * recorded samples conformed to 48 kHz) summed into this SR-rate timeline would
 * play 8.8% slow and smear the very envelope verify-sound.mjs cross-correlates
 * the render against, so any other rate is resampled. Linear interpolation is
 * enough: the premix is a metering reference, not a deliverable.
 */
const resample = (asset) => {
  if (asset.sampleRate === SR) return asset;
  const ratio = SR / asset.sampleRate;
  const frames = Math.floor(asset.frames * ratio);
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const x = i / ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(asset.frames - 1, i0 + 1);
    const f = x - i0;
    left[i] = asset.left[i0] * (1 - f) + asset.left[i1] * f;
    right[i] = asset.right[i0] * (1 - f) + asset.right[i1] * f;
  }
  return {left, right, frames, sampleRate: SR, channels: 2};
};

export const premix = (style, reelId = 'bubble-sort') => {
  const src = reelSource(reelId);
  const timeline = src.timeline(style);
  const events = reelSfxEvents(src, style);
  const total = Math.ceil((timeline.total / FPS) * SR);
  const left = new Float64Array(total);
  const right = new Float64Array(total);

  const cache = new Map();
  for (const e of events) {
    if (!cache.has(e.variant)) {
      cache.set(
        e.variant,
        resample(decodeWav(readFileSync(join(SFX_ROOT, style, `${e.variant}.wav`))))
      );
    }
    const asset = cache.get(e.variant);
    const seqLen = SFX_FRAMES[style][e.variant];
    if (!seqLen) throw new Error(`${style}: no manifest entry for ${e.variant}`);
    const at = Math.round((e.frame / FPS) * SR);
    const n = Math.min(asset.frames, Math.round((seqLen / FPS) * SR));
    for (let i = 0; i < n; i++) {
      const o = at + i;
      if (o >= total) break;
      left[o] += asset.left[i] * e.volume;
      right[o] += asset.right[i] * e.volume;
    }
  }
  return {left, right, events, timeline};
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const style = isMain ? process.argv[2] : null;
if (style) {
  if (!SFX_STYLES.includes(style)) throw new Error(`unknown style "${style}"`);
  const reelId = process.argv[3] ?? 'bubble-sort';
  const {left, right, events, timeline} = premix(style, reelId);
  const {buffer, clipped} = encodeWav(left, right);
  mkdirSync(OUT, {recursive: true});
  const stem = reelId === 'bubble-sort' ? style : `${style}-${reelId}`;
  const file = join(OUT, `premix-${stem}.wav`);
  writeFileSync(file, buffer);

  const peak = Math.max(peakOf(left), peakOf(right));
  const byKind = events.reduce((a, e) => ({...a, [e.kind]: (a[e.kind] ?? 0) + 1}), {});
  console.log(
    `${style.padEnd(8)} ${reelId.padEnd(15)} ${(left.length / SR).toFixed(2)}s  ` +
      `${events.length} events  peak ${gainToDb(peak).toFixed(2)} dBFS  ` +
      `rms ${gainToDb(rmsOf(left)).toFixed(2)} dBFS  ` +
      `clipped ${clipped}  frames ${timeline.total}  ` +
      Object.entries(byKind)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ')
  );
  console.log(`-> out/premix-${stem}.wav`);
}
