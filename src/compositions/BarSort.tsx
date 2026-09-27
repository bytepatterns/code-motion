import React from 'react';
import {Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {COLOR, STAGE, TYPE, ZONE} from '../theme';
import {FONT_MONO, FONT_SANS} from '../fonts';
import {ReelFrame} from '../template/ReelFrame';
import {VISIBLE_LINES} from '../template/CodePanel';
import {SfxTrack} from '../audio/sfx';
import {buildSfxEvents, type SfxEvent, type SfxStyle} from '../audio/sfxEvents';
import {algo} from '../algorithms';
import {
  INTRO,
  type AlgoSpec,
  type BarTimeline,
  type Tone,
  buildBarTimeline,
} from '../algorithms/spec';

/**
 * THE bar-sort scene. One composition renders every sort in src/algorithms
 * (bubble sort ships as the reference); the only thing that changes is the
 * algorithm module it is handed.
 *
 * That is not a tidiness preference — the safe-zone layout below is verified
 * frame-by-frame by scripts/verify-layout.mjs and every band, offset and type
 * size comes from theme.ts. A per-algorithm copy of this file would be four
 * copies of a verified layout drifting apart, so an algorithm may only supply
 * DATA (steps, code, counters, hook) plus the two bounded geometry overrides
 * `maxBarH` / `liftPx`, which are re-verified per render.
 *
 * The bubble-sort path through this component is deliberately identical to the
 * frozen BubbleSortBars it replaced: same springs, same easing, same paint
 * order, same colour rules. Everything other sorts need (amber
 * marks, held cards, i/j pointers, multi-run lock bars) is reachable only from
 * step data bubble sort never produces.
 */

const toneColor: Record<Tone, string> = {
  primary: COLOR.primary,
  secondary: COLOR.secondary,
  warning: COLOR.warning,
  text1: COLOR.text1,
  text2: COLOR.text2,
  text3: COLOR.text3,
};

/** stage geometry — all derived from theme.ts, only the bar height is tunable */
const geometry = (spec: AlgoSpec) => {
  const n = spec.values.length;
  const barsX = ZONE.cardX + STAGE.innerPad; // 88
  const barsW = ZONE.cardW - 2 * STAGE.innerPad; // 784
  const gap = 14;
  return {
    n,
    barsX,
    barsW,
    gap,
    barW: (barsW - (n - 1) * gap) / n, // 85.75
    maxVal: Math.max(...spec.values),
    maxBarH: spec.maxBarH ?? STAGE.maxBarH,
    liftPx: spec.liftPx ?? STAGE.swapLift,
    slotX: (slot: number) => barsX + slot * ((barsW - (n - 1) * gap) / n + gap),
  };
};

/**
 * The SFX schedule depends only on (algorithm, style), so it is computed once
 * per pair and cached at module scope: the render loop must stay free of work,
 * and — more importantly — every style of a given algorithm shares ONE copy of
 * the visual code, so sound can never fork the verified layout.
 */
const sfxCache = new Map<string, SfxEvent[]>();
const sfxFor = (spec: AlgoSpec, t: BarTimeline, style: SfxStyle): SfxEvent[] => {
  const key = `${spec.id}:${style}`;
  const hit = sfxCache.get(key);
  if (hit) return hit;
  const events = buildSfxEvents(t, style, spec.sfxGain ?? 1);
  sfxCache.set(key, events);
  return events;
};

/** contiguous violet runs, so a scattered lock set (quick sort) still reads */
const lockRuns = (sorted: boolean[]) => {
  const runs: {from: number; len: number}[] = [];
  let s = 0;
  while (s < sorted.length) {
    if (!sorted[s]) {
      s++;
      continue;
    }
    let e = s;
    while (e + 1 < sorted.length && sorted[e + 1]) e++;
    runs.push({from: s, len: e - s + 1});
    s = e + 1;
  }
  return runs;
};

export type BarSortProps = {
  /** algorithm id from src/algorithms/index.ts */
  algoId: string;
  /** which SFX bank to play; 'silent' renders no audio */
  sfxStyle: SfxStyle | 'silent';
};

type SlotState = 'idle' | 'compare' | 'swap' | 'sorted' | 'mark' | 'key';

export const BarSort: React.FC<BarSortProps> = ({algoId, sfxStyle}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const spec = algo(algoId);
  const timeline = buildBarTimeline(spec);
  const {steps, starts, lockedAt, sortEnd, finalOrder, counts} = timeline;
  const G = geometry(spec);
  const N = G.n;

  // --- resolve the active step for this frame ---
  let stepIdx = -1;
  for (let s = 0; s < starts.length; s++) {
    if (frame >= starts[s]) stepIdx = s;
    else break;
  }
  const done = frame >= sortEnd;
  const step = !done && stepIdx >= 0 ? steps[stepIdx] : null;

  const order = step ? step.order : done ? finalOrder : spec.values.map((_, i) => i);

  const stepProgress = step
    ? interpolate(frame - starts[stepIdx], [0, step.dur], [0, 1], {extrapolateRight: 'clamp'})
    : 0;

  const sortedMask = done
    ? new Array<boolean>(N).fill(true)
    : step
      ? step.sorted
      : new Array<boolean>(N).fill(false);
  const marks = step ? step.marks : [];
  const heldSlot = step ? step.held : -1;

  // --- code panel active line follows the animation phase ---
  const activeLine = done
    ? spec.doneLine
    : step
      ? step.line2 !== undefined && stepProgress >= (step.line2At ?? 0.6)
        ? step.line2
        : step.line
      : spec.introLine;

  /**
   * The panel only fits VISIBLE_LINES rows inside the safe zone, so the
   * viewport eases — never jumps — between at most two positions.
   *  - `outro`: lines 1-5 carry the sort and the last line is revealed as the
   *    sort ends (bubble sort's early-exit return).
   *  - `body-then-outro`: line 1 is a header only lit during the intro, so the
   *    viewport steps down one line as the sort starts and one more for the
   *    closing line. Two moves in ~20 s; a per-step scroll would be unreadable.
   */
  const ease = {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  } as const;
  const maxScroll = Math.max(0, spec.code.length - VISIBLE_LINES);
  const outroScroll = interpolate(frame, [sortEnd - 8, sortEnd + 4], [0, 1], ease);
  const codeScroll =
    maxScroll === 0
      ? 0
      : spec.scroll === 'outro'
        ? outroScroll * maxScroll
        : Math.min(
            maxScroll,
            interpolate(frame, [INTRO - 8, INTRO + 6], [0, 1], ease) + outroScroll
          );

  const chip = step ? step.chip : done ? spec.doneChip(timeline) : spec.idleChip(timeline);
  const chipIn = spring({frame: frame - 20, fps, config: {damping: 200}, durationInFrames: 18});

  // ---- per-slot bar layout ----
  const arcKey = step ? (step.arc ?? spec.arc ?? 'i') : 'i';
  const arcSlot = step ? (arcKey === 'i' ? step.i : step.j) : -1;
  const slideSlot = step ? (arcKey === 'i' ? step.j : step.i) : -1;
  const travelling = step !== null && (step.type === 'swap' || step.type === 'shift');

  const bars = order.map((id, slot) => {
    const value = spec.values[id];
    const barH = (value / G.maxVal) * G.maxBarH;

    let x = G.slotX(slot);
    let lift = 0;
    const moving = travelling && step !== null && (slot === step.i || slot === step.j);
    const isHeld = slot === heldSlot;

    if (moving && step) {
      const p = Easing.inOut(Easing.cubic)(stepProgress);
      const to = slot === step.i ? step.j : step.i;
      x = interpolate(p, [0, 1], [G.slotX(slot), G.slotX(to)]);
      // A swap sends one partner over the top while the other slides flat, so
      // the baseline is never crossed and the two never read as a single block.
      // SAFE ZONE: the arc is capped at `liftPx` so even the tallest bar's
      // value label stays clear of the Big-O pills at y 502.
      // A shift is the same motion with the travelling partner already in the
      // air — insertion sort's hand does not put the card down to move it.
      lift =
        step.type === 'swap'
          ? slot === arcSlot
            ? -Math.sin(stepProgress * Math.PI) * G.liftPx
            : 0
          : isHeld
            ? -G.liftPx
            : 0;
    } else if (step && step.type === 'lift' && slot === step.i) {
      lift = -stepProgress * G.liftPx;
    } else if (step && step.type === 'drop' && slot === step.i) {
      lift = -(1 - stepProgress) * G.liftPx;
    } else if (isHeld) {
      lift = -G.liftPx;
    }

    const isSorted = done || sortedMask[slot];
    const isMarked = marks.includes(slot);
    const isActive = step ? slot === step.i || (step.j >= 0 && slot === step.j) : false;

    const state: SlotState = isHeld
      ? 'key'
      : moving
        ? 'swap'
        : isActive && step?.type === 'compare'
          ? 'compare'
          : isMarked
            ? 'mark'
            : isSorted
              ? 'sorted'
              : 'idle';

    // The arcing / held partner stays solid; the one sliding underneath switches
    // to an outlined treatment so the overlap is still two readable objects.
    const isSlider = moving && slot === slideSlot;
    const accent =
      state === 'sorted' ? COLOR.secondary : isMarked ? COLOR.warning : COLOR.primary;
    const filled = state === 'sorted' || state === 'key' || (moving && !isSlider);

    const growIn = Math.min(
      1,
      spring({frame: frame - slot * 3, fps, config: {damping: 15, mass: 0.6}, durationInFrames: 30})
    );
    // a card in the air is not settling into place, so it never pops
    const lockPop =
      isSorted && !isHeld
        ? 1 +
          0.06 *
            Math.sin(Math.max(0, frame - lockedAt[slot]) * 0.55) *
            Math.exp(-Math.max(0, frame - lockedAt[slot]) * 0.09)
        : 1;
    const h = barH * growIn * lockPop;
    const top = STAGE.baseline - h + lift;

    const fill = filled ? `linear-gradient(180deg, ${accent}, ${accent}CC)` : COLOR.surfaceRaised;
    const borderColor = filled ? 'transparent' : state === 'idle' ? COLOR.border : accent;
    const glow =
      state === 'idle'
        ? '0 8px 22px #00000066'
        : state === 'sorted'
          ? `0 0 26px ${COLOR.secondary}55`
          : `0 0 38px ${accent}88`;
    const labelColor =
      state === 'sorted' ? COLOR.secondary : state === 'idle' ? COLOR.text1 : accent;

    return {
      id,
      slot,
      value,
      x,
      top,
      h,
      growIn,
      fill,
      borderColor,
      glow,
      labelColor,
      // a floating or travelling label can sit over another bar
      plated: moving || isHeld,
      depth: isHeld ? 3 : !moving ? 0 : isSlider ? 1 : 2,
    };
  });

  // paint order: settled bars, then the sliding partner, then the arcing one,
  // then anything held above the row
  const barsByDepth = [...bars].sort((a, b) => a.depth - b.depth);

  return (
    <ReelFrame
      eyebrow={`${spec.eyebrowLabel} · ${Math.round(durationInFrames / fps)} seconds`}
      hookLines={spec.hook(timeline)}
      badges={spec.badges}
      code={{lines: spec.code, activeLine, scroll: codeScroll}}
      progress={frame / durationInFrames}
    >
      {/* ---- SFX, synced to the step timeline (no music) ---- */}
      {sfxStyle !== 'silent' && (
        <SfxTrack events={sfxFor(spec, timeline, sfxStyle)} style={sfxStyle} />
      )}

      {/* ---- bars (settled first, travelling pair on top) ---- */}
      {barsByDepth.map((b) => (
        <div
          key={`bar-${b.id}`}
          style={{
            position: 'absolute',
            left: b.x,
            top: b.top,
            width: G.barW,
            height: b.h,
            borderRadius: '12px 12px 5px 5px',
            background: b.fill,
            border: `3px solid ${b.borderColor}`,
            boxSizing: 'border-box',
            boxShadow: b.glow,
          }}
        />
      ))}

      {/* ---- value labels: own layer, always above every bar ---- */}
      {bars.map((b) => (
        <div
          key={`val-${b.id}`}
          style={{
            position: 'absolute',
            left: b.x,
            top: b.top - STAGE.labelOffset,
            width: G.barW,
            display: 'flex',
            justifyContent: 'center',
            opacity: b.growIn,
          }}
        >
          <span
            style={{
              fontFamily: FONT_SANS,
              fontSize: TYPE.value,
              fontWeight: 800,
              letterSpacing: -1,
              lineHeight: '48px',
              color: b.labelColor,
              padding: b.plated ? '0 10px' : 0,
              borderRadius: 10,
              background: b.plated ? `${COLOR.canvas}E6` : 'transparent',
            }}
          >
            {b.value}
          </span>
        </div>
      ))}

      {/* ---- baseline ---- */}
      <div
        style={{
          position: 'absolute',
          left: G.barsX - 8,
          top: STAGE.baseline,
          width: G.barsW + 16,
          height: 3,
          borderRadius: 2,
          background: COLOR.border,
        }}
      />

      {/* ---- slot indices, or the algorithm's named pointers ---- */}
      {order.map((_, slot) => {
        const ptr = step?.pointers?.find((p) => p.slot === slot);
        return (
          <div
            key={`ix-${slot}`}
            style={{
              position: 'absolute',
              left: G.slotX(slot),
              top: STAGE.indexTop,
              width: G.barW,
              height: 30,
              lineHeight: '30px',
              textAlign: 'center',
              fontFamily: FONT_MONO,
              fontSize: TYPE.index,
              fontWeight: ptr ? 700 : 500,
              color: ptr ? toneColor[ptr.tone] : sortedMask[slot] ? COLOR.secondary : COLOR.text4,
              opacity: 0.9,
            }}
          >
            {ptr ? ptr.label : slot}
          </div>
        );
      })}

      {/* ---- violet lock-in underline, one bar per contiguous sorted run ---- */}
      {lockRuns(sortedMask).map((run) => (
        <div
          key={`lock-${run.from}`}
          style={{
            position: 'absolute',
            left: G.slotX(run.from) - 5,
            top: STAGE.lockBarTop,
            width: run.len * G.barW + (run.len - 1) * G.gap + 10,
            height: 5,
            borderRadius: 3,
            background: COLOR.secondary,
            opacity: 0.85,
          }}
        />
      ))}

      {/* ---- status chip ---- */}
      <div
        style={{
          position: 'absolute',
          left: ZONE.cardX,
          top: STAGE.chipTop,
          width: ZONE.cardW,
          display: 'flex',
          justifyContent: 'center',
          opacity: chipIn,
        }}
      >
        <div
          style={{
            height: STAGE.chipH,
            display: 'flex',
            alignItems: 'center',
            padding: '0 26px',
            borderRadius: 16,
            border: `2px solid ${toneColor[chip.tone]}66`,
            background: COLOR.surface,
            fontFamily: FONT_MONO,
            fontSize: TYPE.chip,
            fontWeight: 600,
            color: toneColor[chip.tone],
            whiteSpace: 'nowrap',
          }}
        >
          {chip.text}
        </div>
      </div>

      {/* ---- counters ---- */}
      <div
        style={{
          position: 'absolute',
          left: ZONE.cardX,
          top: STAGE.counterTop,
          width: ZONE.cardW,
          height: 38,
          lineHeight: '38px',
          display: 'flex',
          justifyContent: 'center',
          gap: 64,
          fontFamily: FONT_SANS,
          fontSize: TYPE.counter,
          fontWeight: 700,
          color: COLOR.text3,
          opacity: chipIn,
        }}
      >
        {spec.counters.map((c) => {
          const total = c.of.reduce((sum, t) => sum + counts[t], 0);
          const soFar = steps.filter(
            (s, i) => c.of.includes(s.type) && starts[i] <= frame
          ).length;
          return (
            <span key={c.label}>
              {c.label}{' '}
              <span style={{color: toneColor[c.tone], fontVariantNumeric: 'tabular-nums'}}>
                {soFar}
              </span>
              <span style={{color: COLOR.text4}}>/{total}</span>
            </span>
          );
        })}
      </div>
    </ReelFrame>
  );
};
