/**
 * The COMPOSITION-INDEPENDENT timeline contract.
 *
 * A bar sort, binary search and BFS are three different visual grammars with
 * three different components, and the sound pipeline (premix -> LUFS/true-peak
 * metering -> per-event onset verification) must not care which one it is
 * looking at. So every scene publishes the same two things:
 *
 *   total    duration in frames
 *   events   a list of {frame, kind, variant?, volume?}
 *
 * `variant` and `volume` are optional on purpose. A pitch-mapped grammar (the
 * bar sort) names the take because its scale IS the data; every other grammar
 * says only "a swap happens here" and lets `finalizeSfx` draw from the bank
 * pool. Both paths then go through the SAME rate-limiting, ducking and
 * master-gain code, which is what guarantees a new scene inherits the sparse
 * behaviour the existing scenes were balanced against.
 *
 * This file is imported by Node scripts through the ts-register hook, so it —
 * and everything reachable from `registry.ts` — must stay free of React and of
 * any `remotion` import.
 */

import type {RawSfxEvent, SfxEvent, SfxStyle} from '../audio/sfxEvents';
import {DEFAULT_STYLE, finalizeSfx} from '../audio/sfxEvents';

export const FPS = 30;

/** What a composition publishes for a given sound style. */
export type ReelTimeline = {
  /** duration in frames — the Composition's durationInFrames */
  total: number;
  /** scheduled sound events, before rate-limiting */
  events: RawSfxEvent[];
};

export type ReelSource = {
  /** Remotion composition id, e.g. "BinarySearch" */
  compositionId: string;
  /** file stem under out/ and docs/stills/, e.g. "binary-search" */
  outFile: string;
  /** extra ids the CLI tools accept for this scene (e.g. the algorithm id) */
  aliases?: string[];
  /**
   * Per-composition SFX trim, on top of the bank gain and the style master.
   * Density is a property of the GRAMMAR (binary search fires 20 halvings in
   * 12 s; the listicle fires 5 locks in 13 s), so keeping every reel inside the
   * style's LUFS band is a per-reel correction, exactly as `AlgoSpec.sfxGain`
   * already was for the sorts. Defaults to 1.
   */
  gain?: number;
  timeline: (style: SfxStyle) => ReelTimeline;
};

/** The finished, rate-limited schedule for a reel — what actually plays. */
export const reelSfxEvents = (src: ReelSource, style: SfxStyle = DEFAULT_STYLE): SfxEvent[] =>
  finalizeSfx(src.timeline(style).events, style, src.gain ?? 1);

/** Distinct bank stems a reel needs, in a stable order. */
export const reelVariants = (src: ReelSource, style: SfxStyle = DEFAULT_STYLE): string[] =>
  Array.from(new Set(reelSfxEvents(src, style).map((e) => e.variant))).sort();

/** seconds, rounded — used by every eyebrow */
export const seconds = (totalFrames: number) => Math.round(totalFrames / FPS);
