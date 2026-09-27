import type {BarTimeline, StepType} from '../algorithms/spec';

/**
 * SFX scheduling — pure data, no React and no asset imports, so both
 * scripts/make-sfx.mjs (which needs to know WHICH pitched variants to
 * synthesise) and scripts/verify-sound.mjs (which needs the expected onset
 * frames) can import this file directly under Node's TS type stripping.
 *
 * Every bank in public/sfx/<style>/ is synthesised by scripts/make-sfx.mjs from
 * raw PCM, so the soundtrack is licence-free by construction. Deliberately NO
 * background music: trending audio is attached at upload time inside the
 * platform.
 */

export const SFX_STYLES = ['musical', 'tactile', 'arcade', 'calm', 'calm-pad'] as const;
export type SfxStyle = (typeof SFX_STYLES)[number];

/**
 * The style every example scene renders with and the gates verify against.
 * Change it here to re-voice every scene at once, then re-run `npm run check`.
 */
export const DEFAULT_STYLE: SfxStyle = 'calm';

export type SfxKind = 'compare' | 'swap' | 'lock' | 'final' | 'pad';

export type SfxEvent = {
  kind: SfxKind;
  frame: number;
  /** file stem inside public/sfx/<style>/, e.g. "cmp-3" or "swp-6-2" */
  variant: string;
  volume: number;
};

/**
 * What a COMPOSITION emits — the composition-independent half of the contract
 * in src/timeline/spec.ts. `variant` and `volume` are optional because only a
 * pitch-mapped grammar (the bar sorts, whose scale IS the data) has an opinion
 * about which take plays; every other grammar just says "a swap happens here"
 * and lets `finalizeSfx` draw from the bank pool below.
 */
export type RawSfxEvent = {
  kind: SfxKind;
  frame: number;
  variant?: string;
  volume?: number;
};

/**
 * Stems a non-pitch-mapped composition may ask for, by kind.
 *
 * scripts/make-sfx.mjs builds every entry below into EVERY bank (it takes the
 * union of what all registered scenes schedule), which is what makes it safe
 * for a new scene to schedule sound without touching the synthesiser. The
 * rotation is deterministic, so a render is reproducible bit for bit.
 */
const VARIANT_POOL: Record<SfxKind, string[]> = {
  compare: ['cmp-1', 'cmp-3', 'cmp-5'],
  swap: ['swp-4-0', 'swp-6-2', 'swp-5-3'],
  lock: ['lock'],
  final: ['final'],
  pad: ['pad'],
};

// ------------------------------------------------------------- pitch mapping

/**
 * Values are ranked (smallest = 0) and the rank drives the pitch of the sound.
 * Ranking rather than raw value keeps the mapping readable for ANY input array:
 * the ear hears relative order, which is exactly what the algorithm is about.
 * The ranks come from the TIMELINE, not from a module constant, so an
 * algorithm that needs a different array still gets a coherent scale.
 */
export const ranksOf = (values: number[]): number[] =>
  [...new Set(values)].sort((a, b) => a - b);

export const rankOf = (ranks: number[], value: number): number => {
  const r = ranks.indexOf(value);
  return r < 0 ? 0 : r;
};

const compareVariant = (rank: number) => `cmp-${rank}`;
const swapVariant = (a: number, b: number) =>
  `swp-${Math.max(a, b)}-${Math.min(a, b)}`;

/**
 * Which sound a step KIND makes.
 *
 * `shift` (insertion sort) maps to the swap whoosh, not to the compare tick.
 * A shift is a bar physically travelling one slot — same distance, same
 * duration and the same "the array changed" meaning as a swap — while a
 * compare is by definition the step where nothing moves. The sparse rules this
 * style runs on are built around exactly that split (movement speaks,
 * comparison whispers), so mapping a shift to a tick would make insertion
 * sort's 12 real mutations inaudible and its 17 non-events audible.
 *
 * `lift`, `drop` and `mark` get no sound of their own: a drop always coincides
 * with the sorted run growing, so the lock marimba already lands on it, and a
 * mark is a still beat.
 */
const KIND_OF_STEP: Record<StepType, SfxKind | null> = {
  compare: 'compare',
  swap: 'swap',
  shift: 'swap',
  lift: null,
  drop: null,
  mark: null,
};

// ------------------------------------------------------------- rate limiting

/**
 * Minimum spacing between two compare sounds: 4 frames @30fps ≈ 133ms.
 * Anything tighter turns into a machine-gun rattle on phone speakers, so the
 * intermediate compare is dropped; a compare that lands on an accent
 * (swap/lock/final) is kept but ducked so the accent stays the transient.
 */
export const MIN_COMPARE_GAP = 4;
const DUCKED_COMPARE = 0.45;

/** Balance trims applied on top of the bank gain baked into the WAVs. */
const BASE_VOLUME: Record<SfxKind, number> = {
  compare: 1,
  swap: 1,
  lock: 1,
  final: 1,
  pad: 1,
};

// ------------------------------------------------------- per-style scheduling

/**
 * How DENSE a style is allowed to be.
 *
 * This is the fix for the single biggest complaint about the first three
 * styles: 42 scheduled events in 21.2 seconds is a hailstorm regardless of how
 * pretty each individual sound is. Density is a scheduling property, so it is
 * solved here rather than by making the synthesiser quieter — the step DATA is
 * untouched (the visual timeline still shows all 25 compares), only which of
 * those steps get a sound changes.
 *
 * - `compareGap`   minimum frames between two compare sounds.
 * - `skipPreSwap`  drop a compare that is immediately followed by a swap. The
 *                  swap is the answer to that comparison and lands 12 frames
 *                  later, so the pair is one gesture; playing both is what made
 *                  the old banks feel like a machine gun. Compares that do NOT
 *                  lead to a swap are the ones worth marking, because "nothing
 *                  happened" is real information in a bubble sort.
 * - `compareAudible` false = the compare tick is deliberately sub-perceptual
 *                  (see the -33 dBFS `levels.compare` in the calm bank). Used
 *                  by scripts/verify-sound.mjs, which must not demand an onset
 *                  for something engineered to be below the ear's threshold.
 * - `pad`          schedule a sustained bed asset over the whole composition.
 */
export type StyleRules = {
  compareGap: number;
  skipPreSwap: boolean;
  compareAudible: boolean;
  pad: boolean;
};

const DENSE: StyleRules = {
  compareGap: MIN_COMPARE_GAP,
  skipPreSwap: false,
  compareAudible: true,
  pad: false,
};

/** 24 frames = 800 ms. Below ~600 ms a repeated tick starts to feel metric. */
const CALM: StyleRules = {compareGap: 24, skipPreSwap: true, compareAudible: false, pad: false};

export const STYLE_RULES: Record<SfxStyle, StyleRules> = {
  musical: DENSE,
  tactile: DENSE,
  arcade: DENSE,
  calm: CALM,
  'calm-pad': {...CALM, pad: true},
};

/**
 * Per-style master gain, applied on top of the WAV bank.
 *
 * All are 1 and should normally stay there: loudness is set at BUILD time
 * by the per-kind `levels` table in scripts/lib/styles/*.mjs, measured offline
 * with scripts/premix-sfx.mjs + ebur128, and baked into the assets. Trimming
 * here instead would lower the peak headroom the styles were balanced against
 * and pull them out of the -14..-20 LUFS band. This exists only as an escape
 * hatch for mixing a style against future non-SFX audio.
 */
export const STYLE_MASTER: Record<SfxStyle, number> = {
  musical: 1,
  tactile: 1,
  arcade: 1,
  calm: 1,
  'calm-pad': 1,
};

/**
 * The composition-independent half of the scheduler: rate-limiting, ducking,
 * the optional bed, variant defaulting and the master gain.
 *
 * Everything ABOVE this line is bar-sort semantics (which step types speak, how
 * pitch follows the data, when a compare is swallowed by the swap that answers
 * it); everything here applies to any grammar, which is why binary search and
 * BFS can hand it a raw list and inherit exactly the sparse behaviour the bar
 * sort was balanced against.
 *
 * `raw` is consumed in the order given (a stable sort by frame preserves it),
 * so callers that emit "step events first, then locks, then the finale" get the
 * same collision handling the bar sort uses.
 */
export const finalizeSfx = (
  raw: RawSfxEvent[],
  style: SfxStyle = DEFAULT_STYLE,
  /** per-composition trim, see AlgoSpec.sfxGain / ReelSource.gain */
  gain = 1
): SfxEvent[] => {
  const master = STYLE_MASTER[style] * gain;
  const rules = STYLE_RULES[style];

  const accents = raw.filter((e) => e.kind !== 'compare').map((e) => e.frame);
  const ordered = [...raw].sort((a, b) => a.frame - b.frame);

  // deterministic pool rotation for events that did not name a take
  const used: Partial<Record<SfxKind, number>> = {};
  const variantOf = (e: RawSfxEvent) => {
    if (e.variant) return e.variant;
    const pool = VARIANT_POOL[e.kind];
    const k = used[e.kind] ?? 0;
    used[e.kind] = k + 1;
    return pool[k % pool.length];
  };

  const out: SfxEvent[] = [];
  // The bed is scheduled first and at frame 0 so it is already at full level
  // (after its own 1 s fade-in) before the first compare lands at frame 45.
  if (rules.pad) out.push({kind: 'pad', frame: 0, variant: 'pad', volume: BASE_VOLUME.pad * master});
  let lastCompare = -Infinity;
  for (const e of ordered) {
    if (e.kind === 'pad') continue; // the bed is scheduled above, never per-event
    if (e.kind === 'compare') {
      if (e.frame - lastCompare < rules.compareGap) continue; // too soon to be a new gesture
      const onAccent = accents.some((f) => Math.abs(f - e.frame) < MIN_COMPARE_GAP);
      out.push({
        kind: 'compare',
        frame: e.frame,
        variant: variantOf(e),
        volume: (e.volume ?? BASE_VOLUME.compare) * master * (onAccent ? DUCKED_COMPARE : 1),
      });
      lastCompare = e.frame;
    } else {
      out.push({
        kind: e.kind,
        frame: e.frame,
        variant: variantOf(e),
        volume: (e.volume ?? BASE_VOLUME[e.kind]) * master,
      });
    }
  }
  return out;
};

/** Bar-sort semantics: which steps speak, and at what pitch. */
export const rawBarSfxEvents = (
  timeline: BarTimeline,
  style: SfxStyle = DEFAULT_STYLE
): RawSfxEvent[] => {
  const {steps, starts, lockedAt, sortEnd, values} = timeline;
  const rules = STYLE_RULES[style];
  const ranks = ranksOf(values);
  const rank = (value: number) => rankOf(ranks, value);

  const raw: RawSfxEvent[] = [];
  steps.forEach((s, i) => {
    const kind = KIND_OF_STEP[s.type];
    if (!kind) return;
    // a compare whose answer is the very next step is one gesture with it
    if (rules.skipPreSwap && kind === 'compare') {
      const next = steps[i + 1];
      if (next && KIND_OF_STEP[next.type] === 'swap') return;
    }
    const left = values[s.order[s.i]];
    const right = s.j >= 0 ? values[s.order[s.j]] : left;
    if (kind === 'compare') {
      // The NEWLY EXAMINED value drives the pitch: over a pass that plays the
      // array's contents left to right, so the melody IS the data. For a
      // two-bar compare (bubble sort) that is the right-hand bar; where only
      // one bar is under the cursor (selection, quick) it is that bar.
      raw.push({kind: 'compare', frame: starts[i], variant: compareVariant(rank(right))});
    } else {
      // the pair is unordered here on purpose: swapVariant sorts hi/lo itself,
      // so a bank file is shared by every algorithm that swaps the same values
      raw.push({
        kind: 'swap',
        frame: starts[i],
        variant: swapVariant(rank(left), rank(right)),
      });
    }
  });

  // one lock sound per *new* locked slot; slots that never lock stay at sortEnd
  const lockFrames = Array.from(new Set(lockedAt.filter((f) => f < sortEnd)));
  lockFrames.forEach((frame) => raw.push({kind: 'lock', frame, variant: 'lock'}));

  raw.push({kind: 'final', frame: sortEnd, variant: 'final'});
  return raw;
};

export const buildSfxEvents = (
  timeline: BarTimeline,
  style: SfxStyle = DEFAULT_STYLE,
  /** per-algorithm trim, see AlgoSpec.sfxGain */
  gain = 1
): SfxEvent[] => finalizeSfx(rawBarSfxEvents(timeline, style), style, gain);

/** Distinct variant stems a style has to provide, in a stable order. */
export const requiredVariants = (
  timeline: BarTimeline,
  style: SfxStyle = DEFAULT_STYLE
): string[] =>
  Array.from(new Set(buildSfxEvents(timeline, style).map((e) => e.variant))).sort();

export const sfxSrc = (style: SfxStyle, variant: string) => `sfx/${style}/${variant}.wav`;
