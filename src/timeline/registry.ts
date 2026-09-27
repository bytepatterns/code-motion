/**
 * Every scene, behind ONE lookup.
 *
 * make-sfx, premix, verify-sound, check and stills resolve a composition id (or
 * one of its aliases, or its out/ file stem) to a `ReelSource` and ask it for
 * `{total, events}`. None of them knows what a bar sort or a graph is, which is
 * why a new scene is verified by exactly the same gates as the examples.
 *
 * Adding a scene: import its ReelSource here and append it to REEL_SOURCES
 * (then add its <Composition> in src/Root.tsx). See SCENE-SPEC.md.
 *
 * Imported by Node scripts — keep it free of React and of any `remotion` import.
 */

import {ALGO_LIST} from '../algorithms';
import {buildBarTimeline} from '../algorithms/spec';
import {rawBarSfxEvents} from '../audio/sfxEvents';
import {binarySearchReel} from '../scenes/binarySearch';
import {bfsReel} from '../scenes/bfs';
import type {ReelSource} from './spec';

/** every AlgoSpec in src/algorithms renders through the one BarSort composition */
const barSortSources: ReelSource[] = ALGO_LIST.map((spec) => ({
  compositionId: spec.compositionId,
  outFile: spec.outFile,
  aliases: [spec.id],
  gain: spec.sfxGain ?? 1,
  timeline: (style) => {
    const t = buildBarTimeline(spec);
    return {total: t.total, events: rawBarSfxEvents(t, style)};
  },
}));

export const REEL_SOURCES: ReelSource[] = [...barSortSources, binarySearchReel, bfsReel];

export const REEL_IDS = REEL_SOURCES.flatMap((r) => [r.compositionId, ...(r.aliases ?? [])]);

export const reelSource = (id: string): ReelSource => {
  const hit = REEL_SOURCES.find(
    (r) => r.compositionId === id || (r.aliases ?? []).includes(id) || r.outFile === id
  );
  if (!hit) throw new Error(`unknown scene "${id}" — one of ${REEL_IDS.join(', ')}`);
  return hit;
};

export * from './spec';
