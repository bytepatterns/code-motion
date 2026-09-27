/**
 * Full audio verification of a rendered reel.
 *
 *   node --import ./scripts/lib/ts-register.mjs scripts/verify-sound.mjs <style> [mp4] [reel-id]
 *
 * <reel-id> is any composition id, algorithm id or out/ file stem registered in
 * src/timeline/registry.ts — the checks below know nothing about bar sorts.
 *
 * Checks, in order:
 *   1. ffprobe   — an audio stream exists, with the expected codec/rate/layout
 *   2. ebur128   — integrated loudness inside the style's band and true peak
 *                  under the style's ceiling
 *   3. onsets    — every scheduled SFX event that is MEANT to be audible is
 *                  audible at the frame it was scheduled for (RMS-envelope
 *                  onset detection, +-2 frames)
 *   4. spectrum  — spectral centroid and the share of energy above 2.5 kHz, so
 *                  "this style is dark" is a measurement and not an opinion
 *   5. segment   — RMS of a 4 s window in the middle of the sort, to prove the
 *                  body of the track carries level and not just the finale
 *   6. clipping  — no full-scale samples
 *
 * Exits non-zero on any failure so it can gate a render.
 */
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, readFileSync, unlinkSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {decodeWav, gainToDb} from './lib/dsp.mjs';
import {SFX_STYLES, STYLE_RULES} from '../src/audio/sfxEvents.ts';
import {REEL_IDS, reelSfxEvents, reelSource} from '../src/timeline/registry.ts';
import {premix} from './premix-sfx.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'out');
const FPS = 30;

/**
 * Per-style acceptance targets.
 *
 * The dense styles (musical / tactile / arcade) sit in the -20..-14 LUFS band.
 * The two calm banks deliberately sit BELOW it, at -23..-20 LUFS with a -8 dBFS
 * true-peak ceiling: the whole point of the style is that it is less
 * fatiguing, and a "calm" bank mastered to the same loudness as an arcade one
 * is not calm, it is just differently coloured.
 *
 * `band` is the onset-detection passband (see envelopeOf). The dense styles are
 * detected on their transients at 1.2-8 kHz; the calm banks have no transients
 * and nothing above ~2.5 kHz by design, so they are detected on a low-mid band.
 * `onsetRatio` is how much the envelope must rise over the local floor to count
 * as an attack — lower for calm, whose attacks are 16-30 ms swells.
 *
 * Adding a style (or a recorded sample bank) means adding its row here: a
 * target that does not exist cannot be passed.
 */
const TARGETS = {
  musical: {lufs: [-20, -14], truePeak: -6, segRms: 0.008, band: [1200, 8000], onsetRatio: 1.35},
  tactile: {lufs: [-20, -14], truePeak: -6, segRms: 0.008, band: [1200, 8000], onsetRatio: 1.35},
  arcade: {lufs: [-20, -14], truePeak: -6, segRms: 0.008, band: [1200, 8000], onsetRatio: 1.35},
  calm: {
    lufs: [-23, -20],
    truePeak: -8,
    segRms: 0.0025,
    band: [140, 2000],
    onsetRatio: 1.22,
    maxHighEnergy: 0.02,
  },
  'calm-pad': {
    lufs: [-23, -20],
    truePeak: -8,
    segRms: 0.0025,
    band: [140, 2000],
    onsetRatio: 1.22,
    maxHighEnergy: 0.02,
  },
};

const argv = process.argv.slice(2);
const style = argv[0];
if (!SFX_STYLES.includes(style)) {
  throw new Error(`usage: verify-sound.mjs <${SFX_STYLES.join('|')}> [mp4] [reel-id]`);
}
const T = TARGETS[style];
const [LUFS_MIN, LUFS_MAX] = T.lufs;
const TRUE_PEAK_MAX = T.truePeak;
const mp4 = argv.find((a) => a.endsWith('.mp4')) ?? join(OUT, `preview-${style}.mp4`);
if (!existsSync(mp4)) throw new Error(`not found: ${mp4}`);
const reelId = argv.find((a) => REEL_IDS.includes(a)) ?? 'bubble-sort';
const src = reelSource(reelId);
const timeline = src.timeline(style);

const ff = (bin, args) =>
  execFileSync(bin, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26});

/** ffmpeg writes its filter summaries to STDERR, so both streams are needed. */
const ffBoth = (bin, args) => {
  const r = spawnSync(bin, args, {encoding: 'utf8', maxBuffer: 1 << 26});
  return `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
};

const fail = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(26)} ${detail}`);
  if (!ok) fail.push(label);
};

console.log(`\n=== ${reelId} · ${style} — ${mp4} ===`);

// ---------------------------------------------------------------- 1. ffprobe
const probe = JSON.parse(
  ff('ffprobe', [
    '-v', 'error', '-print_format', 'json',
    '-show_streams', '-show_format', mp4,
  ])
);
const audio = probe.streams.find((s) => s.codec_type === 'audio');
const video = probe.streams.find((s) => s.codec_type === 'video');
check(Boolean(audio), 'audio stream present', audio ? `${audio.codec_name} ${audio.sample_rate} Hz ${audio.channels}ch` : 'none');
check(Boolean(video), 'video stream present', video ? `${video.codec_name} ${video.width}x${video.height}` : 'none');
const durSec = Number(probe.format.duration);
const expectSec = timeline.total / FPS;
check(
  Math.abs(durSec - expectSec) < 0.25,
  'duration matches timeline',
  `${durSec.toFixed(2)}s (expected ${expectSec.toFixed(2)}s)`
);

// ---------------------------------------------------------------- 2. ebur128
const ebu = ffBoth('ffmpeg', [
  '-hide_banner', '-nostats', '-i', mp4,
  '-map', '0:a', '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-',
]);
const num = (re) => {
  const m = re.exec(ebu);
  return m ? Number(m[1]) : NaN;
};
const lufs = num(/I:\s+(-?[\d.]+)\s+LUFS/);
const lra = num(/LRA:\s+(-?[\d.]+)\s+LU/);
const truePeak = num(/Peak:\s+(-?[\d.]+)\s+dBFS/);
check(lufs >= LUFS_MIN && lufs <= LUFS_MAX, 'integrated loudness', `${lufs} LUFS (band ${LUFS_MIN}..${LUFS_MAX})`);
check(truePeak <= TRUE_PEAK_MAX, 'true peak', `${truePeak} dBFS (max ${TRUE_PEAK_MAX})`);
console.log(`      loudness range           ${lra} LU`);

// -------------------------------------------------- 3. decode + onset detect
const wav = join(OUT, `verify-${reelId}-${style}.wav`);
ff('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-map', '0:a', '-ac', '1', '-ar', '44100', wav]);
const {left: s, sampleRate: sr, frames: n} = decodeWav(readFileSync(wav));

let peak = 0;
let sumSq = 0;
let clipped = 0;
for (let i = 0; i < n; i++) {
  const a = Math.abs(s[i]);
  if (a >= 0.999) clipped++;
  if (a > peak) peak = a;
  sumSq += s[i] * s[i];
}
check(clipped === 0, 'no clipped samples', `${clipped} at full scale`);
check(Math.sqrt(sumSq / n) > 0.002, 'track not silent', `rms ${gainToDb(Math.sqrt(sumSq / n)).toFixed(2)} dBFS`);

/**
 * Onset verification is done on a BAND-LIMITED envelope (1.2-8 kHz), not the
 * raw one. A broadband detector misses roughly a third of the events in the
 * "musical" style: notes ring for ~450 ms and fire every ~133 ms, so a note
 * arriving on top of a decaying one never doubles the total envelope. Every hit
 * in every style does start with a transient (mallet, tap, blip) while all the
 * tails are lowpassed, so isolating that band turns "new attack" into an
 * unambiguous jump. This is cheap spectral flux without needing an FFT.
 */
const HOP = Math.round(sr * 0.005);
const envelopeOf = (sig, {bandLimit = true} = {}) => {
  const x = Float64Array.from(sig);
  if (bandLimit) {
    const [lo, hi] = T.band;
    const a = 1 - Math.exp((-2 * Math.PI * lo) / sr);
    let lp = 0;
    for (let i = 0; i < x.length; i++) {
      lp += (x[i] - lp) * a;
      x[i] -= lp; // highpass @lo
    }
    const b = 1 - Math.exp((-2 * Math.PI * hi) / sr);
    let y = 0;
    for (let i = 0; i < x.length; i++) {
      y += (x[i] - y) * b; // lowpass @hi
      x[i] = y;
    }
  }
  const count = Math.floor(x.length / HOP);
  const out = new Float64Array(count);
  for (let f = 0; f < count; f++) {
    let e = 0;
    for (let i = f * HOP; i < (f + 1) * HOP; i++) e += x[i] * x[i];
    out[f] = Math.sqrt(e / HOP);
  }
  return out;
};

const envd = envelopeOf(s);
/** env-frames per video frame (5 ms hop at 44.1 kHz => 6.65, NOT an integer) */
const PER_FRAME = sr / (FPS * HOP);
const at = (videoFrame) => Math.round(videoFrame * PER_FRAME);

// ------------------------------------------- 3a. A/V sync vs the offline mix
// The premix is the ground truth: it places every asset at an exact sample
// offset. Cross-correlating the rendered track against it measures whatever
// latency the encoder added, which is the only way to tell "the schedule is
// wrong" apart from "the whole track is shifted".
const ref = envelopeOf(premix(style, reelId).left);
let bestLag = 0;
let bestScore = -Infinity;
for (let lag = -12; lag <= 12; lag++) {
  const shift = at(lag);
  let dot = 0;
  for (let f = 0; f < ref.length; f++) {
    const g = f + shift;
    if (g >= 0 && g < envd.length) dot += ref[f] * envd[g];
  }
  if (dot > bestScore) {
    bestScore = dot;
    bestLag = lag;
  }
}
check(Math.abs(bestLag) <= 3, 'a/v sync offset', `${bestLag} frames (${((bestLag / FPS) * 1000).toFixed(0)} ms) vs premix`);

// ------------------------------------------- 3b. matched per-event detection
const events = reelSfxEvents(src, style);
const rules = STYLE_RULES[style];

/**
 * Which events must produce a detectable attack.
 *
 * `pad` never does — it is a 1 s fade-in on a sustained bed, the exact opposite
 * of an onset. And in the calm banks the compare tick is engineered to sit at
 * -33 dBFS peak, ~20 dB under a swap and under the reverb tail it lands in;
 * demanding an onset for it would be demanding that a deliberately
 * sub-perceptual sound be perceptible. Both are counted and reported below
 * instead, so nothing is quietly dropped from the accounting.
 */
const speaks = (e) => e.kind !== 'pad' && (e.kind !== 'compare' || rules.compareAudible);
// Events scheduled on the same frame (a ducked compare landing on a lock) are
// one audible attack, so they count as one expected onset.
const expected = [...new Set(events.filter(speaks).map((e) => e.frame))].sort((a, b) => a - b);
const silentByDesign = events.filter((e) => !speaks(e));
const NOISE_FLOOR = 0.0006;
const mean = (env, from, to) => {
  let sum = 0;
  let k = 0;
  for (let f = Math.max(0, from); f < Math.min(env.length, to); f++, k++) sum += env[f];
  return k ? sum / k : 0;
};
const peakIn = (env, from, to) => {
  let m = 0;
  for (let f = Math.max(0, from); f < Math.min(env.length, to); f++) m = Math.max(m, env[f]);
  return m;
};
const minIn = (env, from, to) => {
  let m = Infinity;
  for (let f = Math.max(0, from); f < Math.min(env.length, to); f++) m = Math.min(m, env[f]);
  return Number.isFinite(m) ? m : 0;
};

/**
 * The finale is verified differently from the hits, and it has to be:
 *  - it is a 1-2 s musical phrase, not a transient, so a 4-frame window would
 *    only see its (deliberately gentle) first note;
 *  - in the "tactile" style it is a 55-165 Hz swell with a 0.65 s attack, which
 *    has essentially NO energy in the 1.2-8 kHz transient band at all.
 * So: broadband envelope, a window long enough to contain the phrase, and a
 * ratio that asks "did the track get louder here", not "was there an attack".
 */
const envFull = envelopeOf(s, {bandLimit: false});
const kindAt = new Map();
for (const e of events) {
  if (e.kind === 'pad') continue; // covers the whole clip; not an event at a frame
  kindAt.set(e.frame, e.kind === 'final' ? 'final' : (kindAt.get(e.frame) ?? e.kind));
}

const missing = [];
for (const f of expected) {
  const c = f + bestLag;
  let rose;
  if (kindAt.get(f) === 'final') {
    const before = mean(envFull, at(c - 8), at(c) - 1);
    const after = peakIn(envFull, at(c), at(c + 30));
    rose = after > Math.max(before * 1.2, NOISE_FLOOR);
  } else {
    // The reference level is the FLOOR immediately before the attack, not the
    // mean of the preceding window: in the arcade style a compare lands 400 ms
    // after the coin ding, the two do not overlap at all, yet the coin's body
    // sits above the blip's peak and dragged the window mean up far enough to
    // report three perfectly audible blips as silent.
    // Calm attacks are 16-30 ms swells rather than transients, so the search
    // window has to be a little wider than the 3 frames a click needs.
    const span = rules.compareAudible ? 3 : 5;
    const before = minIn(envd, at(c - 2), at(c) + 1);
    const after = peakIn(envd, at(c) - 1, at(c + span));
    rose = after > Math.max(before * T.onsetRatio, NOISE_FLOOR);
  }
  if (!rose) missing.push(f);
}
check(
  missing.length === 0,
  'every event audible',
  `${expected.length - missing.length}/${expected.length} attacks confirmed` +
    (missing.length ? ` — silent at ${missing.join(', ')}` : '')
);
const byKind = events.reduce((acc, e) => ({...acc, [e.kind]: (acc[e.kind] ?? 0) + 1}), {});
console.log(
  `      scheduled events         ${events.length} ` +
    `(${Object.entries(byKind).map(([k, v]) => `${k}:${v}`).join(' ')})`
);
console.log(
  `      onsets required          ${expected.length} distinct frames` +
    (silentByDesign.length ? `  ·  ${silentByDesign.length} sub-perceptual by design` : '')
);

// The sub-perceptual events are not ALLOWED to fail, but they must still be
// there — "quiet by design" and "accidentally never rendered" look identical in
// the pass/fail column. So they get measured and reported, never asserted: the
// number below is how many of the ticks are still above their local floor, i.e.
// present as texture rather than absent.
const quiet = silentByDesign.filter((e) => e.kind !== 'pad');
if (quiet.length) {
  let found = 0;
  let loudest = 0;
  for (const e of quiet) {
    const c = e.frame + bestLag;
    const before = minIn(envd, at(c - 2), at(c) + 1);
    const after = peakIn(envd, at(c) - 1, at(c + 5));
    loudest = Math.max(loudest, after);
    if (after > Math.max(before * 1.1, NOISE_FLOOR * 0.5)) found++;
  }
  console.log(
    `      sub-perceptual ticks     ${found}/${quiet.length} traceable, ` +
      `loudest band envelope ${gainToDb(loudest).toFixed(1)} dBFS (not asserted)`
  );
}

// ------------------------------------------------------ 4. spectral darkness
/**
 * "Is this style actually dark?" measured rather than asserted.
 *
 * A plain radix-2 FFT over 4096-sample Hann windows, hop 2048, accumulating the
 * POWER spectrum of every window that is above the noise floor (silence has a
 * meaningless centroid and there is a lot of silence in a sparse track). From
 * the average spectrum: the spectral centroid, and the share of total energy
 * above 2.5 kHz — the number the calm brief is actually about.
 */
const fft = (re, im) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
};

const NFFT = 4096;
const window = new Float64Array(NFFT);
for (let i = 0; i < NFFT; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (NFFT - 1));
const spec = new Float64Array(NFFT / 2);
let windows = 0;
for (let start = 0; start + NFFT <= n; start += NFFT / 2) {
  let rms = 0;
  for (let i = 0; i < NFFT; i++) rms += s[start + i] * s[start + i];
  rms = Math.sqrt(rms / NFFT);
  if (rms < 1e-4) continue; // silence has no meaningful colour
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  for (let i = 0; i < NFFT; i++) re[i] = s[start + i] * window[i];
  fft(re, im);
  for (let k = 0; k < NFFT / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
  windows++;
}
const binHz = sr / NFFT;
let total = 0;
let weighted = 0;
let above = 0;
for (let k = 1; k < NFFT / 2; k++) {
  const f = k * binHz;
  total += spec[k];
  weighted += spec[k] * f;
  if (f > 2500) above += spec[k];
}
const centroid = total > 0 ? weighted / total : 0;
const highShare = total > 0 ? above / total : 0;
console.log(
  `      spectral centroid        ${centroid.toFixed(0)} Hz  ` +
    `(${windows} windows above the noise floor)`
);
if (T.maxHighEnergy !== undefined) {
  check(
    highShare <= T.maxHighEnergy,
    'energy above 2.5 kHz',
    `${(highShare * 100).toFixed(3)}% of total (max ${(T.maxHighEnergy * 100).toFixed(0)}%)`
  );
} else {
  console.log(`      energy above 2.5 kHz     ${(highShare * 100).toFixed(3)}% of total`);
}

// --------------------------------------------------------- 5. segment RMS
// A 4 s window in the middle of the sort: proves the SFX body carries level and
// the integrated number is not being propped up by the finale alone.
const from = Math.round((expected[2] / FPS) * sr);
const to = Math.min(n, from + 4 * sr);
let segSq = 0;
for (let i = from; i < to; i++) segSq += s[i] * s[i];
const segRms = Math.sqrt(segSq / (to - from));
check(
  segRms > T.segRms,
  'mid-sort 4s segment rms',
  `${gainToDb(segRms).toFixed(2)} dBFS (${(from / sr).toFixed(1)}-${(to / sr).toFixed(1)}s, ` +
    `min ${gainToDb(T.segRms).toFixed(1)})`
);

unlinkSync(wav);

console.log(
  `\nSUMMARY  ${reelId} ${style}: ${lufs} LUFS · true peak ${truePeak} dBFS · LRA ${lra} LU · ` +
    `${events.length} events (${expected.length} onsets required, ${expected.length - missing.length} matched) · ` +
    `centroid ${centroid.toFixed(0)} Hz, ${(highShare * 100).toFixed(3)}% >2.5 kHz · ` +
    `seg rms ${gainToDb(segRms).toFixed(1)} dBFS`
);
if (fail.length) {
  console.error(`\nFAILED: ${fail.join(', ')}`);
  process.exit(1);
}
console.log('AUDIO OK');
