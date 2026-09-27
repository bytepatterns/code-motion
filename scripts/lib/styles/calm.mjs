/**
 * Style "calm" — low, dark, sparse.
 *
 * WHY THIS EXISTS: on a phone speaker, over a 20-second reel, the first three
 * styles (musical / tactile / arcade) all read as ear-grating. The
 * diagnosis was not one bad timbre, it was six compounding decisions, and this
 * module reverses every one of them:
 *
 *  1. DENSITY — 42 events in 21.2 s is a hailstorm. Sparsification is a
 *     SCHEDULING problem, not a synthesis one, so it lives in
 *     src/audio/sfxEvents.ts (STYLE_RULES): for calm only the 12 swaps, the 4
 *     lock-ins and the finale speak; compares are thinned to ~11 sub-perceptual
 *     air-ticks.
 *  2. REGISTER — the old banks sat at C4-C6. Everything here is rooted at C3
 *     (130.8 Hz); the highest fundamental in the bank is E4 (329.6 Hz), the
 *     lock-in reaches down to C2.
 *  3. ATTACK — no transient anywhere. The fastest attack in the file is the
 *     9 ms air-tick; swaps are 16 ms, the lock-in 18 ms, the finale 450 ms.
 *     There is deliberately NO mallet/contact-click layer at all — that layer
 *     is precisely what made the old banks grating.
 *  4. BRIGHTNESS — every voice is triangle/modal (partials falling off as 1/k²
 *     or explicitly damped), and the last thing before the room is a gentle
 *     multi-pole lowpass at 1.4-2.2 kHz. Nothing meaningful survives above
 *     ~2.5 kHz.
 *  5. LEVEL — the per-kind `levels` table below is 3-5 dB under the other
 *     styles' and the bank ceiling is -10 dBFS instead of -6.9, which lands the
 *     track at ~-21 LUFS with a true peak under -8 dBFS.
 *  6. SPACE — a much longer, darker Schroeder room (63 ms combs, 0.62 feedback,
 *     1.4 kHz damping ≈ 0.9 s tail) so an event BLOOMS and fades instead of
 *     ticking. The room is what turns 17 sounds in 21 s into something that
 *     feels continuous rather than sparse-and-empty.
 */

import {
  addModes,
  addNoiseBand,
  addRoom,
  addVoice,
  buffer,
  highpass,
  lowpass,
  percEnv,
  swellEnv,
  trimTail,
} from '../dsp.mjs';
import {C3, PENTATONIC, humanizeCents, humanizeGain, noteHz, rankHz} from '../scale.mjs';

/**
 * Long, dark, wet. Combs are ~2x the "musical" ones and the damping filter
 * inside the feedback path is at 1.4 kHz, so the tail loses its top before it
 * loses its level — the classic "warm room" cue.
 *
 *   t60 ≈ 0.0631 s * 60 / (-20*log10(0.62)) ≈ 0.9 s
 */
const ROOM = {
  mix: 0.34,
  combs: [0.0317, 0.0411, 0.0537, 0.0631],
  feedback: 0.62,
  damp: 1400,
  allpass: 0.0071,
};

/** rank -> Hz on C3 major pentatonic: C3 D3 E3 G3 A3 C4 D4 E4 (130.8 .. 329.6). */
const rankFreq = (rank) => rankHz(C3, rank);

/** Lower notes ring longer, as a struck body actually does. */
const decayFor = (freq) => 0.55 * Math.pow(C3 / freq, 0.4);

/**
 * The shared "felt / hang drum" mode set. Upper modes are damped HARD (the 2nd
 * partial is already 13 dB down and dies in a third of the time) which is what
 * separates a felt-covered hammer from a bare one. Phases are offset so the
 * modes do not all spike on sample 1 — the same crest-factor argument as in
 * musical.mjs, and here it matters more because there is no transient layer to
 * hide behind.
 */
const feltModes = (tau) => [
  {ratio: 1, amp: 1, tau, phase: 0},
  {ratio: 2, amp: 0.21, tau: tau * 0.34, phase: 1.1},
  {ratio: 3, amp: 0.07, tau: tau * 0.17, phase: 2.3},
  {ratio: 4.06, amp: 0.025, tau: tau * 0.08, phase: 0.7},
];

/**
 * compare — a sub-perceptual air-tick, NOT a note.
 *
 * The brief is that a compare must not be an event: 25 of them are what turned
 * the earlier styles into a rattle. So it is unpitched (a narrow noise band
 * around 700-1000 Hz), it has a 9 ms rounded attack rather than a click, and the
 * `levels` table puts it at -33 dBFS peak — roughly 20 dB under a swap, i.e.
 * texture you notice only by its absence. The rank still nudges the band centre
 * a little so repeated ticks are not literally the same file.
 */
export const compare = (rank) => {
  const dur = 0.09;
  const buf = buffer(dur, 0.5);
  addNoiseBand(buf, {
    dur,
    fromHz: 640,
    peakHz: 820 + rank * 26,
    toHz: 520,
    peakAt: 0.3,
    q: 1.15,
    amp: humanizeGain(rank, 4),
    seed: 1500 + rank,
    envelope: (t) => percEnv(t, dur, {attack: 0.009, tau: 0.018, release: 0.03}),
  });
  lowpass(buf, 1500, 2);
  highpass(buf, 260);
  addRoom(buf, {...ROOM, mix: 0.26});
  return trimTail(buf);
};

/**
 * swap — the two values trade places, so their notes trade places: a gentle
 * two-note portamento in the C3 octave.
 *
 * Triangle waves, not saw or square: a triangle's partials fall off as 1/k², so
 * the timbre is already dark BEFORE the filter and the lowpass only has to
 * round it off rather than gouge it. Under the glide sits a quiet felt-piano
 * body on the destination note, which is what gives the slide a place to land —
 * without it a pure glide reads as a synth sweep, with it as an instrument.
 */
export const swap = (hiRank, loRank) => {
  const hi = rankFreq(hiRank);
  const lo = rankFreq(loRank);
  const dur = 0.62;
  const buf = buffer(dur, 1.0);

  const gliss = (f0, f1, amp, salt) =>
    addVoice(buf, {
      dur,
      f0,
      f1,
      // >1 eases out of the start and lands softly; a linear glide arrives with
      // the pitch still moving and reads as a siren.
      curve: 1.7,
      wave: 'triangle',
      amp,
      maxHz: 2400,
      detune: humanizeCents(salt, 2),
      envelope: (t) => percEnv(t, dur, {attack: 0.016, tau: dur / 2.4, release: 0.14}),
    });

  gliss(hi, lo, 0.8, hiRank);
  gliss(lo, hi, 0.58, loRank);

  // the landing: a soft struck body on the lower of the two notes
  addModes(buf, {
    start: 0.004,
    dur: dur * 0.95,
    freq: lo * Math.pow(2, humanizeCents(loRank, 6) / 1200),
    amp: 0.34,
    attack: 0.018,
    modes: feltModes(decayFor(lo) * 0.8),
  });

  lowpass(buf, 2200, 2);
  highpass(buf, 45);
  addRoom(buf, ROOM);
  return trimTail(buf);
};

/**
 * lock-in — a soft deep thump that BLOOMS.
 *
 * C3 body with a C2 sub under it and the fifth (G3) whispered on top, all with
 * 18-30 ms attacks and no contact noise whatsoever, through a 3-pole 1.4 kHz
 * lowpass and the wettest room in the bank. The sub is there for the "felt on a
 * phone, heard on headphones" half of the weight; the fifth is what makes the
 * gesture read as "this slot is settled" instead of "a new note started".
 */
export const lock = () => {
  const dur = 1.15;
  const buf = buffer(dur, 1.1);

  addModes(buf, {
    dur,
    freq: C3,
    amp: 1,
    attack: 0.018,
    modes: [
      {ratio: 1, amp: 1, tau: 0.5, phase: 0},
      {ratio: 2, amp: 0.16, tau: 0.19, phase: 1.4},
      {ratio: 3, amp: 0.04, tau: 0.07, phase: 2.7},
    ],
  });
  addModes(buf, {
    start: 0.005,
    dur: dur - 0.01,
    freq: C3 / 2,
    amp: 0.44,
    attack: 0.026,
    modes: [
      {ratio: 1, amp: 1, tau: 0.42, phase: 0.4},
      {ratio: 2, amp: 0.1, tau: 0.14, phase: 1.9},
    ],
  });
  addModes(buf, {
    start: 0.022,
    dur: dur - 0.03,
    freq: noteHz(C3, 7),
    amp: 0.19,
    attack: 0.032,
    modes: [{ratio: 1, amp: 1, tau: 0.38, phase: 1.2}],
  });

  lowpass(buf, 1400, 3);
  highpass(buf, 36);
  addRoom(buf, {...ROOM, mix: 0.42, feedback: 0.66});
  return trimTail(buf);
};

/**
 * finale — a slow warm resolution, NOT a run.
 *
 * The old finale was a six-note ascending arpeggio, which after 21 s of ticking
 * arrives as one more burst of events. This is two chords: A2+E3 blooming in
 * over ~0.45 s, then C3+G3 (+ a whisper of C4) taking over at 0.9 s. Both
 * chords are inside C major pentatonic, so the move is a vi -> I settle with no
 * leading tone and nothing to clash with whatever platform music is added at
 * upload time. A single quiet struck C3 marks the resolution point so the swell
 * has a moment rather than just a shape.
 *
 * Length is capped under the 2.5 s outro (OUTRO = 75 frames) so the release is
 * never cut by the end of the composition.
 */
export const final = () => {
  const dur = 2.3;
  const buf = buffer(dur, 0.25);

  const swell = (start, len, freq, amp, attack, release, detune = 0) =>
    addVoice(buf, {
      start,
      dur: len,
      f0: freq,
      wave: 'triangle',
      amp,
      maxHz: 2400,
      detune,
      envelope: (t) => swellEnv(t, len, {attack, release}),
    });

  // chord 1 — suspended, arrives out of nowhere
  swell(0, 1.5, noteHz(C3, -3), 0.62, 0.45, 0.75, -4); // A2
  swell(0.02, 1.45, noteHz(C3, 4), 0.34, 0.5, 0.7, 5); // E3

  // chord 2 — the resolution, overlapping chord 1 so there is no seam
  swell(0.88, dur - 0.88, C3, 0.86, 0.5, 0.85, 0); // C3
  swell(0.9, dur - 0.92, noteHz(C3, 7), 0.44, 0.55, 0.8, 6); // G3
  swell(0.95, dur - 1.0, noteHz(C3, 12), 0.17, 0.6, 0.75, -6); // C4, whisper
  swell(0.86, dur - 0.9, C3 / 2, 0.4, 0.55, 0.9, 0); // C2 sub

  // one soft struck body so the resolution has a defined arrival
  addModes(buf, {
    start: 0.9,
    dur: 1.15,
    freq: C3,
    amp: 0.3,
    attack: 0.022,
    modes: feltModes(0.6),
  });

  lowpass(buf, 2000, 2);
  highpass(buf, 34);
  addRoom(buf, {...ROOM, mix: 0.4, feedback: 0.66});
  return trimTail(buf);
};

/**
 * pad — the "calm-pad" variant only (see calm-pad.mjs).
 *
 * One static chord, root + fifth, for the whole video: C2 + C3 + G3, each as
 * three saw/triangle voices detuned by a few cents. The detune is the entire
 * motion in this thing — ±6 cents at 130 Hz beats at roughly 0.5 Hz, which the
 * ear reads as a slow chorus without anything actually moving. Then a 3-pole
 * 620 Hz lowpass takes the top off completely.
 *
 * Deliberately NOT music: no melody, no rhythm, no chord change. It is room
 * tone with a pitch centre, at ~-38 dBFS RMS, whose only job is to give the 17
 * sparse events something to sit in so the gaps stop reading as dropouts. At
 * that level it is ~17 LU under the gated programme loudness, so it does not
 * move the integrated LUFS, and it is quiet and static enough not to fight
 * whatever trending audio is attached at upload time.
 *
 * `durSec` is the full composition length, so the caller (make-sfx.mjs) is the
 * one place that has to know the timeline.
 */
export const pad = (durSec) => {
  const dur = durSec;
  const buf = buffer(dur, 0);
  const fadeIn = 1.0;
  const fadeOut = 1.6;
  const env = (t) => {
    const a = t < fadeIn ? 0.5 - 0.5 * Math.cos((t / fadeIn) * Math.PI) : 1;
    const left = dur - t;
    const r = left < fadeOut ? 0.5 - 0.5 * Math.cos((left / fadeOut) * Math.PI) : 1;
    return Math.max(0, a * r);
  };

  const voice = (freq, wave, amp, detune) =>
    addVoice(buf, {
      dur,
      f0: freq,
      wave,
      amp,
      // partials above this are pointless — the 620 Hz lowpass removes them and
      // they cost 21 s x 44.1 kHz of sin() each
      maxHz: 900,
      detune,
      envelope: env,
    });

  for (const cents of [-7, 0, 6]) {
    voice(C3 / 2, 'saw', 0.5, cents); // C2 root
    voice(C3, 'saw', 0.9, cents * -1); // C3 root
    voice(noteHz(C3, 7), 'triangle', 0.5, cents * 0.8); // G3 fifth
  }

  lowpass(buf, 620, 3);
  highpass(buf, 40);
  return buf; // no trimTail: the pad must cover the whole composition
};

export default {
  id: 'calm',
  label: 'low felt piano, sparse',
  /** narrow, mono-fold-down safe — a wide pad on a phone speaker just smears */
  width: 0.2,
  /**
   * Peak dBFS per kind. Three deliberate differences from the other styles:
   *
   *  - compare is at -33, i.e. ~20 dB under a swap. That is the sparsification
   *    made audible: the ticks are texture, the swaps are the content.
   *  - every accent is 3-5 dB quieter than in musical/tactile, which together
   *    with the -10 dBFS bank ceiling (see `ceiling`) lands the render at
   *    ~-21 LUFS instead of the dense styles' -14..-20. This is
   *    an intentional style decision for a "calm" bank, not a level mistake.
   *  - lock sits ABOVE swap. Swaps are the frequent event (12 of them); the
   *    lock-in happens 4 times and is the only structural cue in the track, so
   *    it is allowed to be the loudest thing before the finale.
   */
  levels: {compare: -33, swap: -11, lock: -9.5, final: -9},
  /**
   * Bank ceiling. The generic -6.9 dBFS ceiling would let two overlapping
   * blooms reach the platform's own limiter; -9 dBFS leaves the AAC encoder
   * room to overshoot the sample peak and still land the render's TRUE peak
   * under -8 dBFS.
   */
  ceiling: -9,
  scaleSteps: PENTATONIC,
  compare,
  swap,
  lock,
  final,
  pad,
};
