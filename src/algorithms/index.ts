/**
 * The sort registry every consumer goes through: Root.tsx, the generic BarSort
 * composition and the Node scripts. Adding a sort means adding an AlgoSpec
 * module, listing it here and extending `AlgoId` in spec.ts — BarSort renders
 * it and Root.tsx registers its composition automatically.
 */
import type {AlgoId, AlgoSpec} from './spec';
import {bubbleSort} from './bubbleSort';

export const ALGO_LIST: AlgoSpec[] = [bubbleSort];

export const ALGORITHMS: Record<AlgoId, AlgoSpec> = {
  'bubble-sort': bubbleSort,
};

export const ALGO_IDS = ALGO_LIST.map((a) => a.id);

export const algo = (id: string): AlgoSpec => {
  const spec = ALGORITHMS[id as AlgoId];
  if (!spec) throw new Error(`unknown algorithm "${id}" — one of ${ALGO_IDS.join(', ')}`);
  return spec;
};

export {bubbleSort};
export * from './spec';
