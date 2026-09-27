/**
 * Style "musical" — data sonification.
 *
 * Every COMPARE plucks a marimba/kalimba-like note whose pitch is the RANK of
 * the value being examined, so the viewer literally hears the array being
 * scanned; a SWAP is the two values' notes gliding through each other; a
 * lock-in is a warm low tap; the finale resolves the pentatonic.
 *
 * Timbre is modal (damped-sine) synthesis using the real mode ratios of a
 * tuned marimba bar (1 : 3.93 : 9.2, upper modes decaying much faster) with a
 * quiet Karplus-Strong string underneath for the grainy tine attack, plus a
 * short filtered-noise mallet transient. No plain sines anywhere.
 */

import {
  addKarplus,
  addModes,
  addNoiseBand,
  addRoom,
  addVoice,
  buffer,
  highpass,
  lowpass,
  percEnv,
  softClip,
  trimTail,
} from '../dsp.mjs';
import {C3, C4, humanizeCents, humanizeGain, PENTATONIC, rankHz} from '../scale.mjs';

const ROOM = {mix: 0.15, combs: [0.0197, 0.0261, 0.0331, 0.0413], feedback: 0.38, damp: 3800};

/** Higher bars ring shorter, exactly like a shorter marimba bar does. */
const decayFor = (freq) => 0.42 * Math.pow(C4 / freq, 0.45);

const mallet = (buf, {amp, bright}) =>
  addNoiseBand(buf, {
    start: 0,
    dur: 0.012,
    fromHz: bright * 0.75,
    peakHz: bright,
    toHz: bright * 0.5,
    peakAt: 0.25,
    q: 0.5,
    amp,
    seed: Math.round(bright),
    envelope: (t) => percEnv(t, 0.012, {attack: 0.0004, tau: 0.0028, release: 0.002}),
  });

export const compare = (rank) => {
  const freq = rankHz(C4, rank);
  const cents = humanizeCents(rank);
  const f = freq * Math.pow(2, cents / 1200);
  const tau = decayFor(f);
  const dur = Math.min(0.52, tau * 1.5);
  const buf = buffer(dur, 0.12);

  addModes(buf, {
    dur,
    freq: f,
    amp: 1 * humanizeGain(rank),
    attack: 0.0015,
    // The mode phases are offset on purpose. Started in phase, all three modes
    // spike together on sample 1 and the note's crest factor goes through the
    // roof; since the ceiling is a hard -6 dBFS, that spike is loudness we can
    // never spend. Offsetting costs nothing audibly and buys ~2 dB of RMS.
    modes: [
      {ratio: 1, amp: 1, tau, phase: 0},
      {ratio: 3.93, amp: 0.3, tau: tau * 0.26, phase: 1.15},
      {ratio: 9.2, amp: 0.09, tau: tau * 0.11, phase: 2.4},
    ],
  });
  // kalimba-ish tine grain: quiet, short, slightly inharmonic
  addKarplus(buf, {
    dur: Math.min(dur, 0.22),
    freq: f,
    amp: 0.2,
    t60: tau * 1.1,
    brightness: 0.5,
    seed: 4001 + rank,
  });
  mallet(buf, {amp: 0.22, bright: 2400 + rank * 130});

  lowpass(buf, 5200, 2);
  highpass(buf, 60);
  addRoom(buf, ROOM);
  // Gentle saturation, i.e. the mallet-bus compressor a mix engineer would
  // reach for. Compares fire every ~133 ms while a note rings for ~450 ms, so
  // up to four notes overlap and their transients stack; rounding each attack
  // here keeps the summed peak off the ceiling and lets the whole style sit
  // ~2 LU louder than it otherwise could.
  softClip(buf, 1.7);
  return trimTail(buf);
};

/**
 * The two compared values swap places, so their notes swap places too: the
 * higher note glides down to where the lower one was and vice versa. The
 * crossing is audible as a genuine portamento, not two separate beeps.
 */
export const swap = (hiRank, loRank) => {
  const hi = rankHz(C4, hiRank);
  const lo = rankHz(C4, loRank);
  const dur = 0.2;
  const buf = buffer(dur, 0.16);

  const gliss = (f0, f1, amp, seedSalt) =>
    addVoice(buf, {
      dur,
      f0,
      f1,
      curve: 1.35, // eases out of the start, lands softly — a slide, not a siren
      wave: 'triangle',
      amp,
      maxHz: 9000,
      detune: humanizeCents(seedSalt, 3),
      envelope: (t) => percEnv(t, dur, {attack: 0.008, tau: dur / 2.2, release: 0.03}),
    });

  gliss(hi, lo, 0.78, hiRank);
  gliss(lo, hi, 0.62, loRank);
  // a breath of movement so the slide has a body, not just tone
  addNoiseBand(buf, {
    dur: dur * 0.8,
    fromHz: 900,
    peakHz: 2100,
    toHz: 700,
    q: 0.85,
    amp: 0.1,
    seed: 8100 + hiRank * 8 + loRank,
    envelope: (t) => percEnv(t, dur * 0.8, {attack: 0.02, tau: dur / 2.6, release: 0.04}),
  });
  mallet(buf, {amp: 0.12, bright: 1900});

  lowpass(buf, 4800, 2);
  highpass(buf, 70);
  addRoom(buf, ROOM);
  return trimTail(buf);
};

/** lock-in — warm low marimba tap on the tonic, two octaves under the bank. */
export const lock = () => {
  const dur = 0.55;
  const buf = buffer(dur, 0.2);
  addModes(buf, {
    dur,
    freq: C3,
    amp: 1,
    attack: 0.003,
    modes: [
      {ratio: 1, amp: 1, tau: 0.4},
      {ratio: 2, amp: 0.22, tau: 0.2},
      {ratio: 3.93, amp: 0.14, tau: 0.1},
    ],
  });
  // the pentatonic fifth on top, quiet — reads as "settled", not as a new note
  addModes(buf, {
    start: 0.008,
    dur: dur - 0.01,
    freq: C3 * Math.pow(2, 7 / 12),
    amp: 0.24,
    modes: [{ratio: 1, amp: 1, tau: 0.24}, {ratio: 3.93, amp: 0.12, tau: 0.07}],
  });
  mallet(buf, {amp: 0.2, bright: 1500});
  lowpass(buf, 3600, 2);
  highpass(buf, 45);
  addRoom(buf, {...ROOM, mix: 0.2});
  return trimTail(buf);
};

/** finale — a gentle rising pentatonic run resolving on the octave. */
export const final = () => {
  const dur = 2.0;
  const buf = buffer(dur, 0.3);
  const run = [0, 1, 2, 3, 4, 5];
  run.forEach((rank, i) => {
    const start = i * 0.115;
    const freq = rankHz(C4, rank);
    const tau = decayFor(freq) * 1.25;
    addModes(buf, {
      start,
      dur: Math.min(0.75, dur - start),
      freq: freq * Math.pow(2, humanizeCents(rank, 5) / 1200),
      amp: 0.5 + i * 0.07,
      attack: 0.0018,
      modes: [
        {ratio: 1, amp: 1, tau},
        {ratio: 3.93, amp: 0.26, tau: tau * 0.24},
        {ratio: 9.2, amp: 0.07, tau: tau * 0.1},
      ],
    });
    addKarplus(buf, {
      start,
      dur: Math.min(0.3, dur - start),
      freq,
      amp: 0.14,
      t60: tau,
      brightness: 0.5,
      seed: 9100 + rank,
    });
  });
  // resolution: the tonic an octave up, held, over a low root pad
  addModes(buf, {
    start: 0.69,
    dur: 1.2,
    freq: rankHz(C4, 5) * 2,
    amp: 0.42,
    modes: [{ratio: 1, amp: 1, tau: 0.6}, {ratio: 3.93, amp: 0.16, tau: 0.14}],
  });
  addModes(buf, {
    start: 0.66,
    dur: 1.3,
    freq: C3,
    amp: 0.5,
    attack: 0.006,
    modes: [{ratio: 1, amp: 1, tau: 0.75}, {ratio: 2, amp: 0.18, tau: 0.3}],
  });
  addModes(buf, {
    start: 0.7,
    dur: 1.25,
    freq: C3 * Math.pow(2, 7 / 12),
    amp: 0.26,
    attack: 0.008,
    modes: [{ratio: 1, amp: 1, tau: 0.68}],
  });

  lowpass(buf, 5400, 2);
  highpass(buf, 50);
  addRoom(buf, {...ROOM, mix: 0.24, feedback: 0.46});
  return trimTail(buf);
};

export default {
  id: 'musical',
  label: 'marimba data sonification',
  /** stereo decorrelation applied by the writer (0 = mono-safe centre) */
  width: 0.18,
  /**
   * Peak dBFS per kind after balancing (see make-sfx.mjs). The compare pluck
   * carries the whole track's loudness — 29 of the 42 events are compares — so
   * it sits only ~2 dB under the accents rather than the ~6 dB a mix engineer
   * would use for a dense track.
   */
  levels: {compare: -10.6, swap: -11.2, lock: -9.6, final: -8.9},
  scaleSteps: PENTATONIC,
  compare,
  swap,
  lock,
  final,
};
