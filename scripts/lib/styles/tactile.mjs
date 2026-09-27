/**
 * Style "tactile" — premium / ASMR minimal.
 *
 * The reference is a good mechanical keyboard on a felt desk mat: a wooden tap
 * with real low-end thump but almost no ring, a brushed felt slide, a muted
 * felt-piano thud for the lock-in and a low warm swell to close.
 *
 * Nothing here is "musical" in the melodic sense — the pitch mapping survives
 * only as a very small (120 -> 183 Hz) body-frequency shift across the ranks,
 * which the ear reads as "different object" rather than "different note". That
 * subtlety is the point of the style: it must never pull attention off the
 * picture, only confirm it.
 */

import {
  addModes,
  addNoiseBand,
  addRoom,
  addVoice,
  buffer,
  compress,
  highpass,
  lowpass,
  peakOf,
  percEnv,
  scale,
  softClip,
  swellEnv,
  trimTail,
} from '../dsp.mjs';
import {A1, humanizeCents, humanizeGain} from '../scale.mjs';

/** Tight, dry, small — a desk, not a hall. */
const ROOM = {mix: 0.09, combs: [0.0091, 0.0127, 0.0163, 0.0211], feedback: 0.3, damp: 2600};

/** rank -> body frequency of the tap. Deliberately a narrow, subliminal span. */
const bodyHz = (rank) => 120 + rank * 9;

export const compare = (rank) => {
  // A pure 20 ms click is authentically "keyboard" but carries almost no energy:
  // at one tap every 133 ms it measured -25.8 LUFS integrated, well under the
  // -14..-20 band the dense styles target, and no amount of gain fixes that without
  // blowing the peak ceiling. The fix is physical rather than a level trick —
  // a real thocky key on a felt mat blooms for ~60 ms — so the low mode is given
  // a proper tail and a mid "cavity" mode. It stays a tap; it now has weight.
  const dur = 0.25;
  const buf = buffer(dur, 0.06);
  const f = bodyHz(rank) * Math.pow(2, humanizeCents(rank, 1) / 1200);

  // low thump — the "landing" of the key
  addModes(buf, {
    dur,
    freq: f,
    amp: 0.95 * humanizeGain(rank, 2),
    attack: 0.0009,
    modes: [
      {ratio: 1, amp: 1, tau: 0.095, phase: 0},
      {ratio: 1.51, amp: 0.24, tau: 0.032, phase: 1.3},
      {ratio: 2.72, amp: 0.14, tau: 0.009, phase: 2.6},
    ],
  });
  // wooden tap — a fast band-limited noise burst, no ring at all
  addNoiseBand(buf, {
    dur: 0.034,
    fromHz: 2700 + rank * 40,
    peakHz: 2100,
    toHz: 1200,
    peakAt: 0.18,
    q: 0.55,
    amp: 0.46,
    seed: 5200 + rank,
    envelope: (t) => percEnv(t, 0.034, {attack: 0.0006, tau: 0.0062, release: 0.004}),
  });
  // contact click: 2 ms, gives the tap its "expensive" definition
  addNoiseBand(buf, {
    dur: 0.006,
    fromHz: 5200,
    peakHz: 4200,
    toHz: 3000,
    q: 0.4,
    amp: 0.16,
    seed: 700 + rank,
    envelope: (t) => percEnv(t, 0.006, {attack: 0.0002, tau: 0.0012, release: 0.001}),
  });

  highpass(buf, 70);
  // A 130 Hz decaying sine has a ~15 dB crest factor, and against a hard
  // -6 dBFS ceiling that is loudness this style can never spend. Two stages
  // buy it back, in this order:
  //   1. compressor — RELEASE MUST BE SHORTER than the thump's own decay
  //      (95 ms), otherwise the gain reduction rides the tail down with the
  //      signal, the crest factor does not change and the whole tap just gets
  //      quieter (measured: -24.7 LUFS with a 90 ms release).
  //   2. gentle saturation for the first few samples the compressor cannot
  //      catch — and it runs BEFORE the lowpass, so the harmonics it generates
  //      are filtered rather than left on top as buzz.
  scale(buf, 1 / (peakOf(buf) || 1));
  compress(buf, {threshold: -11, ratio: 7, attackMs: 0.4, releaseMs: 22});
  softClip(buf, 2.6);
  lowpass(buf, 6400, 2);
  addRoom(buf, ROOM);
  return trimTail(buf);
};

/** swap — a felt brush that sweeps in the direction of the crossing. */
export const swap = (hiRank, loRank) => {
  const dur = 0.24;
  const buf = buffer(dur, 0.08);
  const brush = (seed, amp, from, peak, to) =>
    addNoiseBand(buf, {
      dur,
      fromHz: from,
      peakHz: peak,
      toHz: to,
      peakAt: 0.42,
      q: 0.86,
      amp,
      seed,
      envelope: (t) => percEnv(t, dur, {attack: 0.022, tau: dur / 2.2, release: 0.05, curve: 1.4}),
    });

  brush(3100 + hiRank * 8 + loRank, 0.75, 780, 2000, 860);
  brush(6600 + hiRank * 8 + loRank, 0.42, 480, 1150, 520); // lower, gives it weight

  // the tonal cue: a quiet body glide that follows the swap direction. Noise is
  // peak-inefficient (its crest factor is ~4x a sine's), so the brush alone
  // could never carry the loudness this style needs — the body does that.
  addVoice(buf, {
    dur: dur * 0.92,
    f0: bodyHz(loRank),
    f1: bodyHz(hiRank),
    curve: 1.2,
    wave: 'sine',
    amp: 0.55,
    envelope: (t) => percEnv(t, dur * 0.92, {attack: 0.018, tau: dur / 2.4, release: 0.05}),
  });

  lowpass(buf, 5200, 2);
  highpass(buf, 90);
  addRoom(buf, ROOM);
  return trimTail(buf);
};

/** lock-in — a muted felt-piano thump: real low weight, no top, no ring. */
export const lock = () => {
  const dur = 0.5;
  const buf = buffer(dur, 0.12);
  addModes(buf, {
    dur,
    freq: 98,
    amp: 1,
    attack: 0.0025,
    modes: [
      {ratio: 1, amp: 1, tau: 0.2},
      {ratio: 2.01, amp: 0.26, tau: 0.08},
      {ratio: 3.02, amp: 0.09, tau: 0.035},
    ],
  });
  // felt hammer contact
  addNoiseBand(buf, {
    dur: 0.022,
    fromHz: 1000,
    peakHz: 640,
    toHz: 380,
    q: 0.6,
    amp: 0.3,
    seed: 4477,
    envelope: (t) => percEnv(t, 0.022, {attack: 0.001, tau: 0.005, release: 0.003}),
  });
  lowpass(buf, 1900, 2);
  highpass(buf, 45);
  addRoom(buf, {...ROOM, mix: 0.12});
  return trimTail(buf);
};

/** finale — a low warm swell that arrives rather than announces. */
export const final = () => {
  const dur = 1.9;
  const buf = buffer(dur, 0.25);
  const pad = (freq, amp, detune) =>
    addVoice(buf, {
      dur,
      f0: freq,
      wave: 'triangle',
      amp,
      maxHz: 3000,
      detune,
      envelope: (t) => swellEnv(t, dur, {attack: dur * 0.34, release: dur * 0.5}),
    });

  pad(A1 * 2, 0.9, 0); // A2
  pad(A1 * 3, 0.4, 4); // E3, a fifth up
  pad(A1, 0.55, -3); // A1 sub, phone speakers will only feel this one
  // a whisper of air on top so the swell has texture, not just tone
  addNoiseBand(buf, {
    dur,
    fromHz: 2600,
    peakHz: 4200,
    toHz: 2200,
    q: 0.9,
    amp: 0.055,
    seed: 20250823,
    envelope: (t) => swellEnv(t, dur, {attack: dur * 0.45, release: dur * 0.45}),
  });

  lowpass(buf, 3200, 2);
  highpass(buf, 38);
  addRoom(buf, {...ROOM, mix: 0.16, feedback: 0.4});
  return trimTail(buf);
};

export default {
  id: 'tactile',
  label: 'ASMR wood + felt',
  width: 0.26,
  /**
   * Peak dBFS per kind after balancing. The compare tap is pushed nearly to the
   * ceiling and the finale swell is pulled DOWN under it — the opposite of the
   * other two styles. A sustained pad reaches its loudness through duration,
   * not peak, so letting it own the ceiling would starve the taps of the ~5 LU
   * they need and open a 13 LU loudness range, which reads as "the sound cuts
   * out and then shouts at you".
   */
  levels: {compare: -8.1, swap: -8.9, lock: -8.1, final: -10.4},
  compare,
  swap,
  lock,
  final,
};
