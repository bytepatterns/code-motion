/**
 * The step/timeline model shared by every bar-sort reel.
 *
 * One composition (compositions/BarSort.tsx) renders ALL sorting reels; an
 * algorithm module only produces DATA — a step list, the Python the code panel
 * shows, the counters, the badges and the hook. That split is deliberate:
 *
 *  - the safe-zone layout is verified frame-by-frame (scripts/verify-layout.mjs)
 *    and must never be forked per algorithm, so nothing here may describe
 *    geometry beyond two clearly-bounded overrides (`maxBarH`, `liftPx`);
 *  - the hook and every chip are FUNCTIONS of the finished timeline, so a claim
 *    like "6 swaps" is a measurement of the real run and cannot drift from what
 *    the viewer is watching.
 *
 * This file is imported by Node scripts through the ts-register hook, so it must
 * stay free of React and of any `remotion` import.
 */

export const FPS = 30;
/** frames before the first step: the intro spring + hook read */
export const INTRO = 45;
/** frames after the last step: the "sorted" beat + final chime */
export const OUTRO = 75;

/** 8 values, two digits each so labels stay >= 44px and readable. */
export const VALUES = [42, 17, 63, 8, 55, 23, 71, 31];

/**
 * What a step DOES on the stage. Everything an algorithm wants to show has to
 * map onto one of these, which is what keeps the renderer a single component:
 *
 *  - `compare` no motion; slot i (and j, when >= 0) light up coral
 *  - `swap`    slots i and j exchange places, one arcing over the other
 *  - `shift`   same motion as a swap, but the partner that travels stays lifted
 *              out of the row (insertion sort's "hand" carrying the card)
 *  - `lift`    the bar at slot i rises out of the row
 *  - `drop`    the held card at slot i settles back onto the baseline
 *  - `mark`    a still beat: a pivot is chosen, a minimum is re-marked, an
 *              element is already where it belongs
 */
export type StepType = 'compare' | 'swap' | 'shift' | 'lift' | 'drop' | 'mark';

export type Tone = 'primary' | 'secondary' | 'warning' | 'text1' | 'text2' | 'text3';

export type Chip = {text: string; tone: Tone};

/**
 * Replaces the slot INDEX under a bar with a named pointer (`i`, `j`, `p`).
 * Quick sort is unreadable without them and the index row is the only place
 * inside the safe zone that can carry them without a new band.
 */
export type Pointer = {slot: number; label: string; tone: Tone};

export type BarStep = {
  type: StepType;
  /** primary slot */
  i: number;
  /** second slot, or -1 when the step only involves `i` */
  j: number;
  /** slot -> element id, state BEFORE this step */
  order: number[];
  /** which slots are violet-locked BEFORE this step */
  sorted: boolean[];
  /** amber-marked slots (current minimum, pivot) BEFORE this step */
  marks: number[];
  /** slot of the card held above the row BEFORE this step, -1 = none */
  held: number;
  /** named pointers replacing the slot index, if any */
  pointers?: Pointer[];
  /** which partner arcs over the top; overrides the spec default */
  arc?: 'i' | 'j';
  dur: number;
  /** 1-based code line lit for this step */
  line: number;
  /** optional second line, lit from `line2At` (0..1) of the step onward */
  line2?: number;
  line2At?: number;
  chip: Chip;
};

/** A counter under the stage: "comparisons 12/25". */
export type CounterSpec = {label: string; of: StepType[]; tone: Tone};

export type BadgeSpec = {value: string; label: string; tone: 'primary' | 'secondary'};

export type HookLine = {text: string; accent?: string};

export type BarTimeline = {
  values: number[];
  steps: BarStep[];
  /** first frame of each step */
  starts: number[];
  /** first frame at which each slot entered the violet region (sortEnd if never) */
  lockedAt: number[];
  sortEnd: number;
  total: number;
  finalOrder: number[];
  counts: Record<StepType, number>;
  /**
   * Algorithm-specific tallies that are not a step type — quick sort's number
   * of partitions, say. Hooks may only quote numbers that come from here or
   * from `counts`, so every claim in a hook is a measurement of the real run.
   */
  stats: Record<string, number>;
};

/** Extend this union when you add a sort (SCENE-SPEC.md, "A new sort instead"). */
export type AlgoId = 'bubble-sort';

export type AlgoSpec = {
  id: AlgoId;
  /** Remotion composition id */
  compositionId: string;
  /** file stem under out/ and docs/stills/ */
  outFile: string;
  /** eyebrow prefix — the eyebrow itself is "<label> · <n> seconds" */
  eyebrowLabel: string;
  values: number[];
  build: (values: number[]) => {
    steps: BarStep[];
    finalOrder: number[];
    stats?: Record<string, number>;
  };
  /** the lesson's Python, <= 42 monospace chars per line */
  code: string[];
  /** line lit before the first step */
  introLine: number;
  /** line lit once the sort is over */
  doneLine: number;
  /**
   * Code-panel viewport schedule. The panel shows 5 rows.
   *  - `outro`         6 lines: rows 1-5 carry the sort, the last line is the
   *                    outro reveal (bubble sort's early-exit return).
   *  - `body-then-outro` 7 lines: row 1 is a signature/`for` header only lit in
   *                    the intro, rows 2-6 carry the sort, row 7 is the outro
   *                    reveal. Two eased one-line moves, never a per-step jump.
   */
  scroll: 'outro' | 'body-then-outro';
  /** tallest bar in px; defaults to STAGE.maxBarH */
  maxBarH?: number;
  /** how high an arcing / held card rises; defaults to STAGE.swapLift */
  liftPx?: number;
  /** which swap partner arcs over the other; defaults to 'i' */
  arc?: 'i' | 'j';
  counters: CounterSpec[];
  badges: BadgeSpec[];
  hook: (t: BarTimeline) => HookLine[];
  idleChip: (t: BarTimeline) => Chip;
  doneChip: (t: BarTimeline) => Chip;
  /**
   * Extra SFX trim for this algorithm, on top of the bank gain and the style
   * master. Density is a property of the ALGORITHM (selection sort has half the
   * audible accents of insertion sort over the same 21 s), so keeping every
   * reel inside the style's LUFS band is an algorithm-level correction, not a
   * bank-level one — retuning the bank would drag bubble sort out of the band
   * it was already measured into. Defaults to 1.
   */
  sfxGain?: number;
};

const emptyCounts = (): Record<StepType, number> => ({
  compare: 0,
  swap: 0,
  shift: 0,
  lift: 0,
  drop: 0,
  mark: 0,
});

const cache = new Map<AlgoId, BarTimeline>();

export const buildBarTimeline = (spec: AlgoSpec): BarTimeline => {
  const hit = cache.get(spec.id);
  if (hit) return hit;

  const n = spec.values.length;
  const {steps, finalOrder, stats} = spec.build(spec.values);

  const starts: number[] = [];
  let t = INTRO;
  for (const s of steps) {
    starts.push(t);
    t += s.dur;
  }
  const sortEnd = t;

  // First frame at which each slot entered the violet region. A slot that never
  // locks during the sort (the last one to fall into place) stays at sortEnd,
  // where the finale takes over — same rule the bubble reel has always used.
  const lockedAt = new Array<number>(n).fill(sortEnd);
  steps.forEach((s, idx) => {
    for (let slot = 0; slot < n; slot++) {
      if (s.sorted[slot]) lockedAt[slot] = Math.min(lockedAt[slot], starts[idx]);
    }
  });

  const counts = emptyCounts();
  for (const s of steps) counts[s.type]++;

  const timeline: BarTimeline = {
    values: spec.values,
    steps,
    starts,
    lockedAt,
    sortEnd,
    total: sortEnd + OUTRO,
    finalOrder,
    counts,
    stats: stats ?? {},
  };
  cache.set(spec.id, timeline);
  return timeline;
};

/** seconds, rounded — used by every eyebrow */
export const seconds = (t: BarTimeline) => Math.round(t.total / FPS);

/** all-false / all-true masks, the two states every builder starts and ends in */
export const mask = (n: number, fill = false) => new Array<boolean>(n).fill(fill);
