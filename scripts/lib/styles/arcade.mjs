/**
 * Style "arcade" — 8-bit byte-brand.
 *
 * Square and triangle waves, a NES-style end-of-note pitch bend, and a real
 * bitcrusher (amplitude quantisation + sample-and-hold). What makes it modern
 * rather than nostalgic-painful is the mix discipline: every voice is
 * band-limited before it is crushed and the whole bank is lowpassed at ~5.5 kHz,
 * so the chip character survives but the 8-12 kHz shriek of an actual 2A03 does
 * not. Pitch is still mapped to the bar's rank, quantised to the pentatonic.
 */

import {
  addNoiseBand,
  addRoom,
  addVoice,
  bitcrush,
  buffer,
  highpass,
  lowpass,
  percEnv,
  trimTail,
} from '../dsp.mjs';
import {C3, C5, humanizeGain, PENTATONIC, rankHz} from '../scale.mjs';

/** Small, bright, plastic — a cabinet, not a room. */
const ROOM = {mix: 0.08, combs: [0.0071, 0.0103, 0.0139, 0.0179], feedback: 0.28, damp: 4200};

/** Chip envelopes are gates, not exponentials: full level, then cut. */
const gate = (dur, {attack = 0.0012, hold = 0.55, release = 0.014} = {}) => (t) => {
  if (t < 0 || t > dur) return 0;
  const a = t < attack ? t / attack : 1;
  const holdEnd = dur * hold;
  const d = t < holdEnd ? 1 : Math.max(0, 1 - ((t - holdEnd) / (dur - holdEnd)) * 0.45);
  const left = dur - t;
  const r = left < release ? left / release : 1;
  return a * d * r;
};

export const compare = (rank) => {
  const dur = 0.06;
  const buf = buffer(dur, 0.02);
  const f = rankHz(C5, rank);

  // classic blip: flat, then a small downward bend in the last third
  addVoice(buf, {
    dur,
    f0: f,
    f1: f * 0.94,
    curve: 3.2,
    wave: 'square',
    amp: 0.9 * humanizeGain(rank, 4),
    maxHz: 9000,
    envelope: gate(dur, {hold: 0.6}),
  });
  // triangle an octave down: the body that stops it sounding thin on phones
  addVoice(buf, {
    dur: dur * 0.9,
    f0: f / 2,
    wave: 'triangle',
    amp: 0.34,
    maxHz: 7000,
    envelope: gate(dur * 0.9, {hold: 0.5}),
  });

  bitcrush(buf, {bits: 8, holdHz: 16538, mix: 0.85});
  lowpass(buf, 5600, 2);
  highpass(buf, 90);
  addRoom(buf, ROOM);
  return trimTail(buf);
};

/** swap — the classic descending zap, but bounded by the two real notes. */
export const swap = (hiRank, loRank) => {
  const dur = 0.15;
  const buf = buffer(dur, 0.04);
  const hi = rankHz(C5, hiRank);
  const lo = rankHz(C5, loRank);

  // main sweep: starts a fifth above the high note, lands on the low note
  addVoice(buf, {
    dur,
    f0: hi * 1.5,
    f1: lo * 0.75,
    curve: 1.7,
    wave: 'square',
    amp: 0.85,
    maxHz: 9000,
    envelope: gate(dur, {attack: 0.001, hold: 0.3, release: 0.02}),
  });
  // saw layer = duty-cycle change in disguise; gives the zap its bite
  addVoice(buf, {
    dur: dur * 0.85,
    f0: hi * 0.75,
    f1: lo * 0.5,
    curve: 1.7,
    wave: 'saw',
    amp: 0.3,
    maxHz: 7000,
    envelope: gate(dur * 0.85, {hold: 0.25}),
  });
  addNoiseBand(buf, {
    dur: dur * 0.7,
    fromHz: 3200,
    peakHz: 1400,
    toHz: 600,
    peakAt: 0.5,
    q: 0.7,
    amp: 0.18,
    seed: 1500 + hiRank * 8 + loRank,
    envelope: (t) => percEnv(t, dur * 0.7, {attack: 0.001, tau: dur / 3.4, release: 0.02}),
  });

  bitcrush(buf, {bits: 7, holdHz: 11025, mix: 0.8});
  lowpass(buf, 5200, 2);
  highpass(buf, 100);
  addRoom(buf, ROOM);
  return trimTail(buf);
};

/** lock-in — the coin: short grace note, then the held one. Square + triangle. */
export const lock = () => {
  const dur = 0.3;
  const buf = buffer(dur, 0.06);
  const a = 987.77; // B5
  const b = 1318.51; // E6
  const layer = (start, len, freq, sqAmp, triAmp) => {
    addVoice(buf, {
      start,
      dur: len,
      f0: freq,
      wave: 'square',
      amp: sqAmp,
      maxHz: 9000,
      envelope: gate(len, {hold: 0.72, release: 0.02}),
    });
    addVoice(buf, {
      start,
      dur: len,
      f0: freq,
      wave: 'triangle',
      amp: triAmp,
      maxHz: 8000,
      envelope: gate(len, {hold: 0.72, release: 0.02}),
    });
  };
  layer(0, 0.062, a, 0.8, 0.3);
  layer(0.062, 0.235, b, 0.85, 0.35);
  // sub octave under the held note so the ding has weight
  addVoice(buf, {
    start: 0.062,
    dur: 0.2,
    f0: b / 4,
    wave: 'triangle',
    amp: 0.22,
    maxHz: 6000,
    envelope: gate(0.2, {hold: 0.5}),
  });

  bitcrush(buf, {bits: 8, holdHz: 16538, mix: 0.8});
  lowpass(buf, 5800, 2);
  highpass(buf, 90);
  addRoom(buf, ROOM);
  return trimTail(buf);
};

/** finale — a 3-note victory jingle over a triangle bass pedal. */
export const final = () => {
  const dur = 1.15;
  const buf = buffer(dur, 0.15);
  // C5 - G5 - C6, i.e. degrees 0, 3 and the octave of the same pentatonic
  const notes = [
    {start: 0.0, len: 0.135, freq: rankHz(C5, 0), amp: 0.78},
    {start: 0.145, len: 0.135, freq: rankHz(C5, 3), amp: 0.84},
    {start: 0.29, len: 0.66, freq: rankHz(C5, 5), amp: 0.9},
  ];
  notes.forEach((n, i) => {
    addVoice(buf, {
      start: n.start,
      dur: n.len,
      f0: n.freq,
      wave: 'square',
      amp: n.amp,
      maxHz: 9000,
      envelope: gate(n.len, {hold: i === 2 ? 0.55 : 0.75, release: 0.02}),
    });
    addVoice(buf, {
      start: n.start,
      dur: n.len,
      f0: n.freq / 2,
      wave: 'triangle',
      amp: 0.3,
      maxHz: 7000,
      envelope: gate(n.len, {hold: 0.6}),
    });
  });
  // bass pedal: root, then the octave, like every 8-bit fanfare ever written
  addVoice(buf, {
    dur: 0.29,
    f0: C3,
    wave: 'triangle',
    amp: 0.45,
    maxHz: 6000,
    envelope: gate(0.29, {hold: 0.7}),
  });
  addVoice(buf, {
    start: 0.29,
    dur: 0.68,
    f0: C3 * 2,
    wave: 'triangle',
    amp: 0.42,
    maxHz: 6000,
    envelope: gate(0.68, {hold: 0.55}),
  });

  bitcrush(buf, {bits: 8, holdHz: 16538, mix: 0.75});
  lowpass(buf, 5800, 2);
  highpass(buf, 80);
  addRoom(buf, {...ROOM, mix: 0.13, feedback: 0.34});
  return trimTail(buf);
};

export default {
  id: 'arcade',
  label: 'chiptune, modern mix',
  width: 0.14,
  /**
   * Square waves are peak-efficient (a near-flat crest factor), so the same
   * peak buys far more loudness here than it does for the marimba. The compare
   * blip is therefore held ~4 dB below the accents — pushed any higher the
   * track lands over -14 LUFS and reads as the harsh chiptune we are avoiding.
   */
  levels: {compare: -10.0, swap: -8.5, lock: -7.5, final: -6.9},
  scaleSteps: PENTATONIC,
  compare,
  swap,
  lock,
  final,
};
