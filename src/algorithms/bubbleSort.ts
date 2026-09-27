/**
 * Deterministic bubble-sort step engine — the reference implementation of the
 * AlgoSpec contract in spec.ts. Its steps, chips, counters and hook are all
 * derived from the real run, which is what lets any other sort reuse the same
 * verified <BarSort> composition instead of forking it.
 */

import {type AlgoSpec, type BarStep, VALUES, buildBarTimeline} from './spec';

export {FPS, INTRO, OUTRO, VALUES} from './spec';

export const COMPARE_DUR = 12;
export const SWAP_DUR = 18;

const build = (values: number[]) => {
  const n = values.length;
  const order = values.map((_, idx) => idx);
  const steps: BarStep[] = [];
  const val = (slot: number) => values[order[slot]];
  /** bubble sort locks the RIGHT end: `pass` slots are final after each pass */
  const sortedMask = (pass: number) =>
    Array.from({length: n}, (_, slot) => slot >= n - pass);

  for (let pass = 0; pass < n - 1; pass++) {
    let swapped = false;
    for (let k = 0; k < n - 1 - pass; k++) {
      const a = val(k);
      const b = val(k + 1);
      const willSwap = a > b;
      steps.push({
        type: 'compare',
        i: k,
        j: k + 1,
        order: [...order],
        sorted: sortedMask(pass),
        marks: [],
        held: -1,
        dur: COMPARE_DUR,
        line: CODE_LINE.compare,
        chip: {
          text: `${a} ${willSwap ? '>' : '≤'} ${b} · ${willSwap ? 'swap' : 'keep'}`,
          tone: willSwap ? 'primary' : 'text2',
        },
      });
      if (willSwap) {
        steps.push({
          type: 'swap',
          i: k,
          j: k + 1,
          order: [...order],
          sorted: sortedMask(pass),
          marks: [],
          held: -1,
          dur: SWAP_DUR,
          line: CODE_LINE.swap,
          chip: {text: `swap ${a} ↔ ${b}`, tone: 'primary'},
        });
        [order[k], order[k + 1]] = [order[k + 1], order[k]];
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  return {steps, finalOrder: order};
};

/**
 * Python source shown in the code panel.
 * SAFE ZONE: the panel is 840px wide, so the longest line must stay <= 42
 * monospace chars at 30px (0.6em advance) — hence `arr` instead of `nums`.
 */
export const CODE_LINES = [
  'for end in range(len(arr)-1, 0, -1):',
  '  swapped = False',
  '  for i in range(end):',
  '    if arr[i] > arr[i+1]:',
  '      arr[i], arr[i+1] = arr[i+1], arr[i]',
  '  if not swapped: return arr',
];

export const CODE_LINE = {
  outerLoop: 1,
  flag: 2,
  innerLoop: 3,
  compare: 4,
  swap: 5,
  earlyExit: 6,
} as const;

export const bubbleSort: AlgoSpec = {
  id: 'bubble-sort',
  compositionId: 'BubbleSortBars',
  outFile: 'bubble-sort',
  eyebrowLabel: 'Sorting',
  values: VALUES,
  build,
  code: CODE_LINES,
  introLine: CODE_LINE.outerLoop,
  doneLine: CODE_LINE.earlyExit,
  scroll: 'outro',
  counters: [
    {label: 'comparisons', of: ['compare'], tone: 'text1'},
    {label: 'swaps', of: ['swap'], tone: 'primary'},
  ],
  badges: [
    {value: 'O(n²)', label: 'time', tone: 'primary'},
    {value: 'O(1)', label: 'space', tone: 'secondary'},
  ],
  hook: (t) => [{text: 'Can you sort this'}, {text: 'in ', accent: `${t.counts.swap} swaps?`}],
  idleChip: (t) => ({text: `${t.values.length} values · unsorted`, tone: 'text3'}),
  doneChip: (t) => ({text: `sorted in ${t.counts.swap} swaps`, tone: 'secondary'}),
};

/** Back-compat helper for the scripts that were written against this module. */
export const buildTimeline = () => buildBarTimeline(bubbleSort);
