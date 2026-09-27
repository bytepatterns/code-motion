/**
 * Scene — binary search.
 *
 * The claim in the hook ("1,000,000 items … 20 steps") is not a constant: the
 * loop below is really executed at module load over a 1,000,000-element array
 * and the hook, the code panel's closing comment, the step ladder and the
 * counters all read `STEPS.length`. If the array size ever changes, every
 * number on screen changes with it — which is the same discipline
 * `algorithms/spec.ts` already enforces for the sorting reels.
 *
 * React-free: imported by the Node scripts through the ts-register hook.
 */

import type {RawSfxEvent} from '../audio/sfxEvents';
import type {ReelSource} from '../timeline/spec';
import {group} from './format';

export const N = 1_000_000;
/** a[i] = i, so the target value and its index are the same number */
export const TARGET = 782_913;

/** frames before the first halving: intro spring + hook read */
const INTRO = 45;
/** the first steps are slow enough to READ; the tail is the point being made */
const SLOW_DUR = 30;
const SLOW_STEPS = 3;
const FAST_DUR = 18;
/** fraction of a step spent reading the comparison before the half collapses */
export const CUT_AT = 0.35;
/** frames between "found" (lock) and the closing chime */
const FINAL_GAP = 24;
/** long enough for the 1.83 s gentle-message finale to resolve inside the clip */
const OUTRO = FINAL_GAP + 60;

export type BsStep = {
  /** 1-based step number */
  k: number;
  /** range BEFORE this step */
  lo: number;
  hi: number;
  mid: number;
  /** range AFTER this step */
  loA: number;
  hiA: number;
  dir: 'right' | 'left';
  /** this step dropped a digit off "items left" — 1,000,000 -> 999,999 is not
   * news, 1,000,000 -> 62,500 is, and it is the only milestone the algorithm
   * actually has between "start" and "found" */
  decade: boolean;
  /** visible index window before / after — the bar zooms so a 1/1000-wide
   * range is still a range and not a single pixel */
  view: [number, number];
  viewA: [number, number];
  start: number;
  dur: number;
  /** 1-based code line lit once the comparison has been read */
  line: number;
};

/**
 * Lower-bound binary search: exactly ceil(log2(n)) iterations for ANY target,
 * which is what makes "20 steps" a property of the array size rather than of
 * this particular lookup.
 */
const simulate = () => {
  const steps: Omit<BsStep, 'view' | 'viewA' | 'start' | 'dur' | 'line'>[] = [];
  let lo = 0;
  let hi = N - 1;
  let k = 0;
  const digits = (n: number) => String(n).length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const goRight = mid < TARGET;
    const loA = goRight ? mid + 1 : lo;
    const hiA = goRight ? hi : mid;
    steps.push({
      k: ++k,
      lo,
      hi,
      mid,
      loA,
      hiA,
      dir: goRight ? 'right' : 'left',
      decade: digits(hiA - loA + 1) < digits(hi - lo + 1),
    });
    lo = loA;
    hi = hiA;
  }
  return {steps, found: lo};
};

const {steps: rawSteps, found} = simulate();

/**
 * The visible window. A halving is only legible while the range is a visible
 * fraction of the bar, so once the range drops under 1/16 of the window the
 * window re-normalises to 4x the range — three visible halvings per zoom. The
 * magnification is shown on screen (`zoom` below), so the rescale is never a
 * silent change of units.
 */
const ZOOM_TRIGGER = 16;
const ZOOM_SPAN = 4;
const viewFor = (lo: number, hi: number, current: [number, number]): [number, number] => {
  const size = hi - lo + 1;
  const viewSize = current[1] - current[0] + 1;
  if (size * ZOOM_TRIGGER >= viewSize) return current;
  const span = Math.max(2, size * ZOOM_SPAN);
  const centre = (lo + hi) / 2;
  let vLo = Math.round(centre - span / 2);
  vLo = Math.max(0, Math.min(N - span, vLo));
  return [vLo, vLo + span - 1];
};

export const STEPS: BsStep[] = [];
{
  let t = INTRO;
  let view: [number, number] = [0, N - 1];
  for (const s of rawSteps) {
    const dur = s.k <= SLOW_STEPS ? SLOW_DUR : FAST_DUR;
    const viewA = viewFor(s.loA, s.hiA, view);
    STEPS.push({
      ...s,
      view,
      viewA,
      start: t,
      dur,
      line: s.dir === 'right' ? 4 : 5,
    });
    view = viewA;
    t += dur;
  }
}

export const SEARCH_END = STEPS[STEPS.length - 1].start + STEPS[STEPS.length - 1].dur;
export const FINAL_AT = SEARCH_END + FINAL_GAP;
export const TOTAL = SEARCH_END + OUTRO;
export const STEP_COUNT = STEPS.length;
export const FOUND_AT = found;

export const CODE = [
  'lo, hi = 0, n - 1',
  'while lo < hi:',
  '    mid = (lo + hi) // 2',
  '    if a[mid] < target: lo = mid + 1',
  '    else: hi = mid',
  `return lo  # ${STEP_COUNT} steps, n = ${group(N)}`,
];
export const CODE_INTRO_LINE = 1;
export const CODE_MID_LINE = 3;
export const CODE_DONE_LINE = 6;

export const HOOK = [
  {text: `${group(N)} items.`},
  {text: 'Found in ', accent: `${STEP_COUNT} steps.`},
];

/**
 * Sound mapping:
 *   compare  the mid is read against the target — the moment nothing moves
 *   swap     the halving; half the range physically leaves
 *   lock     a digit fell off "items left" (6 times over the run), and finally
 *            the range collapsed to one item: found
 *   final    closing chime, a beat after the lock so the two do not smear
 *
 * The milestone lock is the one addition to the literal algorithm and it is
 * load-bearing: twenty identical halvings have no shape, while
 * "1,000,000 -> 62,500" is the only settling this algorithm does between
 * "start" and "found" — and "lock" is the "something is now settled" sound in
 * every scene. It also carries level: halvings alone are a sparse track.
 *
 * The calm scheduling rules then thin the compares out on their own (24-frame
 * minimum gap, sub-perceptual level), so an 18-frame step cadence produces one
 * audible gesture per step, not two.
 */
export const events = (): RawSfxEvent[] => {
  const out: RawSfxEvent[] = [];
  for (const s of STEPS) {
    out.push({kind: 'compare', frame: s.start});
    out.push({kind: 'swap', frame: s.start + Math.round(s.dur * CUT_AT)});
    // on the settled number, not on the movement that produced it
    if (s.decade) out.push({kind: 'lock', frame: s.start + s.dur - 1});
  }
  out.push({kind: 'lock', frame: SEARCH_END});
  out.push({kind: 'final', frame: FINAL_AT});
  return out;
};

export const binarySearchReel: ReelSource = {
  compositionId: 'BinarySearch',
  outFile: 'binary-search',
  aliases: ['binary-search'],
  // per-scene loudness trim, measured by `npm run check` (SCENE-SPEC.md §3)
  gain: 0.8,
  timeline: () => ({total: TOTAL, events: events()}),
};
