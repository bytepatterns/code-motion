/**
 * SFX — shared DSP primitives.
 *
 * Everything here is plain float math on Float64Array buffers; nothing is
 * downloaded and ffmpeg is never used to synthesise. The
 * whole SFX bank must be licence-free by
 * construction, so every timbre below is built from noise, oscillators,
 * one-pole / state-variable filters and delay lines only.
 */

export const SR = 44100;
export const TAU = Math.PI * 2;

/** -6 dBFS = 0.5012. We stop a touch under so AAC's true peak stays inside. */
export const PEAK_TARGET = 0.45; // ≈ -6.9 dBFS sample peak

export const seconds = (n) => Math.round(n * SR);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);

/** Deterministic PRNG — re-running the generator produces identical bytes. */
export const makeRandom = (seed) => {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s / 0xffffffff) * 2 - 1;
  };
};

// ------------------------------------------------------------------ envelopes

/**
 * Percussive envelope: raised-cosine attack, exponential body, raised-cosine
 * release so the tail never ends on a discontinuity (which would click).
 */
export const percEnv = (t, dur, {attack = 0.004, tau = dur / 3, release = 0.02, curve = 1} = {}) => {
  if (t < 0 || t > dur) return 0;
  const a = t < attack ? 0.5 - 0.5 * Math.cos((t / attack) * Math.PI) : 1;
  const d = Math.exp(-Math.pow(t / tau, curve));
  const left = dur - t;
  const r = left < release ? 0.5 - 0.5 * Math.cos((left / release) * Math.PI) : 1;
  return a * d * r;
};

/** Swell envelope: slow raised-cosine in, plateau, raised-cosine out. */
export const swellEnv = (t, dur, {attack = dur * 0.4, release = dur * 0.45} = {}) => {
  if (t < 0 || t > dur) return 0;
  const a = t < attack ? 0.5 - 0.5 * Math.cos((t / attack) * Math.PI) : 1;
  const left = dur - t;
  const r = left < release ? 0.5 - 0.5 * Math.cos((left / release) * Math.PI) : 1;
  return a * r;
};

// -------------------------------------------------------------------- filters

/** One-pole lowpass coefficient for a cutoff in Hz. */
export const onePoleA = (hz) => 1 - Math.exp((-TAU * Math.min(hz, SR * 0.45)) / SR);

/** In-place one-pole lowpass over the whole buffer. */
export const lowpass = (buf, hz, poles = 1) => {
  const a = onePoleA(hz);
  for (let p = 0; p < poles; p++) {
    let y = 0;
    for (let i = 0; i < buf.length; i++) {
      y += (buf[i] - y) * a;
      buf[i] = y;
    }
  }
  return buf;
};

/** In-place one-pole highpass (DC / rumble removal). */
export const highpass = (buf, hz) => {
  const a = onePoleA(hz);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += (buf[i] - y) * a;
    buf[i] -= y;
  }
  return buf;
};

// ---------------------------------------------------------------- oscillators

/**
 * Band-limited additive waves. `k` is the harmonic number; every partial above
 * `maxHz` is dropped so nothing aliases into a harsh whistle.
 */
const WAVE_PARTIALS = {
  sine: (k) => (k === 1 ? 1 : 0),
  square: (k) => (k % 2 === 1 ? 1 / k : 0),
  triangle: (k) => (k % 2 === 1 ? (((k - 1) / 2) % 2 === 0 ? 1 : -1) / (k * k) : 0),
  saw: (k) => (k % 2 === 1 ? 1 / k : -1 / k),
};

/**
 * A single voice with an exponential pitch glide and a chosen waveform.
 * Phase is accumulated per partial so a glide never phase-jumps.
 *
 *   f(p) = f0 * (f1/f0) ^ (p ^ curve)
 */
export const addVoice = (
  buf,
  {
    start = 0,
    dur,
    f0,
    f1 = null,
    curve = 1,
    wave = 'sine',
    amp = 1,
    maxHz = 12000,
    envelope = (t) => percEnv(t, dur),
    detune = 0,
  }
) => {
  const shape = WAVE_PARTIALS[wave];
  const hi = f1 ?? f0;
  const topF = Math.max(f0, hi);
  const kMax = Math.max(1, Math.floor(Math.min(maxHz, SR * 0.45) / topF));
  const weights = [];
  for (let k = 1; k <= kMax; k++) {
    const w = shape(k);
    if (w !== 0) weights.push([k, w]);
  }
  if (!weights.length) return buf;
  let norm = 0;
  for (const [, w] of weights) norm += Math.abs(w);
  const phases = new Float64Array(weights.length);
  const i0 = seconds(start);
  const n = seconds(dur);
  const bend = Math.pow(2, detune / 1200);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const p = n > 1 ? i / (n - 1) : 0;
    const f = (f1 === null ? f0 : f0 * Math.pow(hi / f0, Math.pow(p, curve))) * bend;
    let s = 0;
    for (let w = 0; w < weights.length; w++) {
      const [k, weight] = weights[w];
      phases[w] += (TAU * f * k) / SR;
      s += weight * Math.sin(phases[w]);
    }
    const idx = i0 + i;
    if (idx >= 0 && idx < buf.length) buf[idx] += (amp * envelope(t) * s) / norm;
  }
  return buf;
};

/**
 * Modal (damped-sine additive) synthesis — the honest way to get a struck-bar
 * timbre. Real marimba bars are tuned so the 2nd mode sits near 3.9x and the
 * 3rd near 9.2x the fundamental, and the upper modes die far faster than the
 * fundamental; that ratio+decay pair is what the ear hears as "wood", so it is
 * modelled explicitly instead of being faked with a static harmonic stack.
 */
export const addModes = (buf, {start = 0, dur, freq, amp = 1, modes, attack = 0.002}) => {
  const i0 = seconds(start);
  const n = seconds(dur);
  let norm = 0;
  for (const m of modes) norm += m.amp;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const a = t < attack ? 0.5 - 0.5 * Math.cos((t / attack) * Math.PI) : 1;
    const left = dur - t;
    const r = left < 0.02 ? 0.5 - 0.5 * Math.cos((left / 0.02) * Math.PI) : 1;
    let s = 0;
    for (const m of modes) {
      s += m.amp * Math.exp(-t / m.tau) * Math.sin(TAU * freq * m.ratio * t + (m.phase ?? 0));
    }
    const idx = i0 + i;
    if (idx >= 0 && idx < buf.length) buf[idx] += (amp * a * r * s) / norm;
  }
  return buf;
};

/**
 * Karplus-Strong plucked string. Gives the grainy, slightly inharmonic attack a
 * pure modal stack cannot; layered under the modes it reads as a kalimba tine.
 * `t60` is the time to -60 dB, converted into the per-lap loop gain.
 */
export const addKarplus = (
  buf,
  {start = 0, dur, freq, amp = 1, t60 = 0.5, brightness = 0.55, seed = 1, envelope = null}
) => {
  const N = Math.max(2, Math.round(SR / freq));
  const line = new Float64Array(N);
  const rnd = makeRandom(seed);
  let lp = 0;
  const a = brightness;
  for (let i = 0; i < N; i++) {
    lp += (rnd() - lp) * a;
    line[i] = lp;
  }
  // remove DC so the string does not drift the whole buffer
  let mean = 0;
  for (let i = 0; i < N; i++) mean += line[i];
  mean /= N;
  for (let i = 0; i < N; i++) line[i] -= mean;

  const loopGain = Math.pow(10, (-3 * N) / (SR * t60));
  const n = seconds(dur);
  const i0 = seconds(start);
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const cur = line[idx];
    const nxt = line[(idx + 1) % N];
    line[idx] = loopGain * 0.5 * (cur + nxt);
    idx = (idx + 1) % N;
    const t = i / SR;
    const e = envelope ? envelope(t) : t > dur - 0.02 ? Math.max(0, (dur - t) / 0.02) : 1;
    const o = i0 + i;
    if (o >= 0 && o < buf.length) buf[o] += amp * e * cur;
  }
  return buf;
};

/**
 * Noise through a resonant state-variable bandpass whose centre frequency
 * moves along a 3-point path. Used for wooden taps, felt brushes and whooshes.
 */
export const addNoiseBand = (
  buf,
  {
    start = 0,
    dur,
    fromHz,
    peakHz = null,
    toHz = null,
    peakAt = 0.5,
    q = 0.7,
    amp = 1,
    seed = 1337,
    envelope = null,
  }
) => {
  const rnd = makeRandom(seed);
  const i0 = seconds(start);
  const n = seconds(dur);
  const mid = peakHz ?? fromHz;
  const end = toHz ?? mid;
  let lp = 0;
  let bp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const p = n > 1 ? i / (n - 1) : 0;
    const cut =
      p < peakAt
        ? fromHz + (mid - fromHz) * (peakAt > 0 ? p / peakAt : 1)
        : mid + (end - mid) * (peakAt < 1 ? (p - peakAt) / (1 - peakAt) : 1);
    const f = 2 * Math.sin((Math.PI * Math.min(Math.max(cut, 20), SR * 0.45)) / SR);
    const input = rnd();
    const hp = input - lp - q * bp;
    bp += f * hp;
    lp += f * bp;
    const e = envelope ? envelope(t) : percEnv(t, dur, {attack: 0.003, tau: dur / 3});
    const idx = i0 + i;
    if (idx >= 0 && idx < buf.length) buf[idx] += amp * e * bp;
  }
  return buf;
};

// ------------------------------------------------------------- shaping / glue

/** Bitcrush: amplitude quantisation + sample-and-hold rate reduction. */
export const bitcrush = (buf, {bits = 8, holdHz = 11025, mix = 1} = {}) => {
  const levels = Math.pow(2, bits - 1);
  const hold = Math.max(1, Math.round(SR / holdHz));
  let held = 0;
  for (let i = 0; i < buf.length; i++) {
    if (i % hold === 0) held = Math.round(buf[i] * levels) / levels;
    buf[i] = buf[i] * (1 - mix) + held * mix;
  }
  return buf;
};

/**
 * Feed-forward peak compressor with a proper attack/release envelope follower.
 *
 * Why this and not just more waveshaping: a decaying percussive hit has a huge
 * crest factor, and the -6 dBFS ceiling means all that crest is loudness we can
 * never spend. A waveshaper buys it back by adding harmonics (fine on a chip
 * blip, audible as buzz on a 130 Hz thump); a compressor buys it back by
 * turning the transient down and letting the tail come up, which is what a
 * "premium" hit actually is.
 */
export const compress = (buf, {threshold = -18, ratio = 4, attackMs = 3, releaseMs = 60, makeup = 0} = {}) => {
  const thr = dbToGain(threshold);
  const aA = 1 - Math.exp(-1 / ((attackMs / 1000) * SR));
  const aR = 1 - Math.exp(-1 / ((releaseMs / 1000) * SR));
  const mk = dbToGain(makeup);
  let envd = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = Math.abs(buf[i]);
    envd += (x - envd) * (x > envd ? aA : aR);
    let g = 1;
    if (envd > thr) {
      const over = envd / thr;
      g = Math.pow(over, 1 / ratio - 1); // gain reduction, in linear terms
    }
    buf[i] *= g * mk;
  }
  return buf;
};

/** Gentle asymmetric-free soft clip; keeps transients from spiking the peak. */
export const softClip = (buf, drive = 1) => {
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * drive) / Math.tanh(drive);
  return buf;
};

/**
 * Room tone: a tiny Schroeder-style reverb (4 lowpassed feedback combs + 1
 * allpass). Not a convincing hall — deliberately. It exists only so every hit
 * in a style shares one small wooden/plastic space and the set sounds like a
 * kit rather than four unrelated files.
 */
export const addRoom = (buf, {mix = 0.16, combs = [0.0231, 0.0297, 0.0371, 0.0437], feedback = 0.42, damp = 4200, allpass = 0.0053} = {}) => {
  const n = buf.length;
  const wet = new Float64Array(n);
  const a = onePoleA(damp);
  for (const time of combs) {
    const d = Math.max(1, seconds(time));
    const line = new Float64Array(d);
    let lp = 0;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const out = line[idx];
      wet[i] += out;
      lp += (out - lp) * a;
      line[idx] = buf[i] + lp * feedback;
      idx = (idx + 1) % d;
    }
  }
  for (let i = 0; i < n; i++) wet[i] /= combs.length;

  const d = Math.max(1, seconds(allpass));
  const line = new Float64Array(d);
  let idx = 0;
  const g = 0.5;
  for (let i = 0; i < n; i++) {
    const bufOut = line[idx];
    const input = wet[i];
    const out = -g * input + bufOut;
    line[idx] = input + g * out;
    idx = (idx + 1) % d;
    wet[i] = out;
  }

  for (let i = 0; i < n; i++) buf[i] = buf[i] * (1 - mix * 0.35) + wet[i] * mix;
  return buf;
};

/**
 * Build a right channel that is phase-decorrelated from the left by a pair of
 * short allpasses. Allpasses are flat in magnitude, so a listener on a phone
 * speaker (mono fold-down) gets only a shallow ripple instead of the deep comb
 * a Haas delay would produce — width that is safe to throw away.
 */
export const widen = (left, width) => {
  if (!width) return null;
  const right = Float64Array.from(left);
  for (const [timeSec, g] of [[0.0009, 0.62], [0.0017, 0.48]]) {
    const d = Math.max(1, seconds(timeSec));
    const line = new Float64Array(d);
    let idx = 0;
    for (let i = 0; i < right.length; i++) {
      const delayed = line[idx];
      const input = right[i];
      const out = -g * input + delayed;
      line[idx] = input + g * out;
      idx = (idx + 1) % d;
      right[i] = out;
    }
  }
  for (let i = 0; i < right.length; i++) right[i] = (1 - width) * left[i] + width * right[i];
  return right;
};

/** Allocate a buffer long enough for `dur` plus a reverb/decay tail. */
export const buffer = (dur, tail = 0) => new Float64Array(seconds(dur + tail));

export const peakOf = (buf) => {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  return max;
};

export const rmsOf = (buf) => {
  let s = 0;
  for (const v of buf) s += v * v;
  return Math.sqrt(s / buf.length);
};

export const scale = (buf, g) => {
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
};

/**
 * Trim a trailing silent tail so the WAV (and therefore the Remotion sequence
 * that has to cover it) is not padded with dead samples.
 */
export const trimTail = (buf, floor = 1e-4) => {
  let end = buf.length;
  while (end > 1 && Math.abs(buf[end - 1]) < floor) end--;
  // leave 5 ms so the release is never cut mid-slope
  end = Math.min(buf.length, end + seconds(0.005));
  return buf.subarray(0, end);
};

// ----------------------------------------------------------------- wav writer

/**
 * Written as STEREO on purpose: Remotion/ffmpeg upmix a mono asset onto the
 * stereo AAC track with a -3 dB per-channel pan law, and at a fixed -6 dBFS
 * peak ceiling that is 3 dB of loudness we could not get back.
 * `width` decorrelates the right channel a little (mono-fold-down safe).
 *
 * `rate` defaults to the synthesiser's SR; a sample-based bank you add can pass
 * the rate its source recordings are conformed to (e.g. 48000).
 */
export const encodeWav = (left, right, rate = SR) => {
  const n = left.length;
  const data = Buffer.alloc(n * 4);
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    const chans = [left[i], right ? right[i] : left[i]];
    for (let c = 0; c < 2; c++) {
      let v = chans[c];
      if (v > 1 || v < -1) clipped++;
      v = Math.max(-1, Math.min(1, v));
      data.writeInt16LE(Math.round(v * 32767), i * 4 + c * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22); // stereo
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return {buffer: Buffer.concat([header, data]), clipped};
};

/** Read back a 16-bit PCM WAV into {left,right,sampleRate} float arrays. */
export const decodeWav = (bytes) => {
  let pos = 12;
  let dataStart = 0;
  let dataLen = 0;
  let sampleRate = SR;
  let channels = 1;
  while (pos + 8 <= bytes.length) {
    const id = bytes.toString('ascii', pos, pos + 4);
    const size = bytes.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      channels = bytes.readUInt16LE(pos + 10);
      sampleRate = bytes.readUInt32LE(pos + 12);
    }
    if (id === 'data') {
      dataStart = pos + 8;
      dataLen = size;
      break;
    }
    pos += 8 + size + (size % 2);
  }
  const frames = Math.floor(dataLen / (2 * channels));
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = bytes.readInt16LE(dataStart + i * 2 * channels) / 32768;
    right[i] =
      channels > 1 ? bytes.readInt16LE(dataStart + i * 2 * channels + 2) / 32768 : left[i];
  }
  return {left, right, sampleRate, channels, frames};
};
