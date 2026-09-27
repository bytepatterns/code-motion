import React from 'react';
import {Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {COLOR, STAGE, TYPE, ZONE} from '../theme';
import {FONT_MONO, FONT_SANS} from '../fonts';
import {ReelFrame} from '../template/ReelFrame';
import {VISIBLE_LINES} from '../template/CodePanel';
import {SfxTrack} from '../audio/sfx';
import type {SfxStyle} from '../audio/sfxEvents';
import {reelSfxEvents} from '../timeline/spec';
import {
  CODE,
  CODE_DONE_LINE,
  CODE_INTRO_LINE,
  CODE_MID_LINE,
  CUT_AT,
  FOUND_AT,
  HOOK,
  N,
  SEARCH_END,
  STEPS,
  STEP_COUNT,
  TARGET,
  binarySearchReel,
} from '../scenes/binarySearch';
import {group} from '../scenes/format';

/**
 * Binary search.
 *
 * Same template, new grammar. Everything below lives inside the stage card that
 * <ReelFrame> draws (y 514-1092) and inside the safe zone's x:[60,900]; the hook
 * band, code band, scrubber and watermark are the frozen template and are not
 * touched here. The vertical budget inside the card:
 *
 *   548-626  lo / mid / hi readout   (the only place range numbers are printed)
 *   636-712  the range bar           (halving, eliminated half fading; the
 *                                    zoom badge rides inside its top-right)
 *   756-840  items-left + target     (the magnitude claim, in full digits)
 *   856-908  20-step ladder          (every step of the hook, as an object)
 *   960+     chip / counters         (template positions, shared with BarSort)
 *
 * The bar ZOOMS (scenes/binarySearch.ts computes the window). A range that is
 * 1/1000 of a million cannot be drawn on an 840 px bar, so after three visible
 * halvings the window re-normalises and the magnification is printed next to
 * the bar — the alternative is a bar that is visibly doing nothing for the last
 * twelve steps, which is exactly the half of the algorithm worth showing.
 */

const BARS_X = ZONE.cardX + STAGE.innerPad; // 88
const BARS_W = ZONE.cardW - 2 * STAGE.innerPad; // 784

const READOUT_LABEL_TOP = 548;
const READOUT_VALUE_TOP = 578;
const BAR_TOP = 636;
const BAR_H = 76;
/** the zoom caption is a badge INSIDE the bar's top-right corner */
const ZOOM_INSET = 10;
const ZOOM_H = 26;
const MAG_LABEL_TOP = 756;
const MAG_VALUE_TOP = 782;
const LADDER_TOP = 856;
const LADDER_CAPTION_TOP = 878;

const LADDER_GAP = 6;
const TICK_W = (BARS_W - (STEP_COUNT - 1) * LADDER_GAP) / STEP_COUNT;

const ease = Easing.inOut(Easing.cubic);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const Readout: React.FC<{
  col: number;
  label: string;
  value: string;
  tone: string;
  opacity?: number;
}> = ({col, label, value, tone, opacity = 1}) => {
  const w = BARS_W / 3;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: BARS_X + col * w,
          top: READOUT_LABEL_TOP,
          width: w,
          height: 28,
          lineHeight: '28px',
          textAlign: 'center',
          fontFamily: FONT_SANS,
          fontSize: TYPE.eyebrow - 2,
          fontWeight: 800,
          letterSpacing: 3,
          textTransform: 'uppercase',
          color: COLOR.text4,
          opacity,
        }}
      >
        {label}
      </div>
      <div
        style={{
          position: 'absolute',
          left: BARS_X + col * w,
          top: READOUT_VALUE_TOP,
          width: w,
          height: 50,
          lineHeight: '50px',
          textAlign: 'center',
          fontFamily: FONT_MONO,
          fontSize: TYPE.value,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: tone,
          opacity,
        }}
      >
        {value}
      </div>
    </>
  );
};

export const BinarySearch: React.FC<{sfxStyle: SfxStyle | 'silent'}> = ({sfxStyle}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  // ---- which step is on screen ----
  let stepIdx = -1;
  for (let i = 0; i < STEPS.length; i++) {
    if (frame >= STEPS[i].start) stepIdx = i;
    else break;
  }
  const done = frame >= SEARCH_END;
  const step = !done && stepIdx >= 0 ? STEPS[stepIdx] : null;
  const p = step ? clamp01((frame - step.start) / step.dur) : 0;
  /** 0 before the half starts collapsing, 1 once it is gone */
  const cut = step ? ease(clamp01((p - CUT_AT) / (1 - CUT_AT))) : 0;
  const flipped = cut >= 0.5;

  // ---- the visible index window (zoom) ----
  const view: [number, number] = done
    ? STEPS[STEPS.length - 1].viewA
    : step
      ? [
          step.view[0] + (step.viewA[0] - step.view[0]) * cut,
          step.view[1] + (step.viewA[1] - step.view[1]) * cut,
        ]
      : [0, N - 1];
  const viewSpan = Math.max(1, view[1] - view[0]);
  const pos = (idx: number) => clamp01((idx - view[0]) / viewSpan) * BARS_W;
  const magnification = (N - 1) / viewSpan;

  // ---- the live range ----
  const before = step ? {lo: step.lo, hi: step.hi} : {lo: 0, hi: N - 1};
  const after = step
    ? {lo: step.loA, hi: step.hiA}
    : done
      ? {lo: FOUND_AT, hi: FOUND_AT}
      : before;
  const shown = done ? {lo: FOUND_AT, hi: FOUND_AT} : flipped ? after : before;
  const size = shown.hi - shown.lo + 1;

  const introIn = spring({frame, fps, config: {damping: 200}, durationInFrames: 24});
  const lockPulse = done
    ? 1 + 0.35 * Math.sin((frame - SEARCH_END) * 0.5) * Math.exp(-(frame - SEARCH_END) * 0.08)
    : 1;

  // the surviving segment, and the half that is on its way out
  const liveFrom = pos(done ? FOUND_AT : step ? step.loA : before.lo);
  const liveTo = pos(done ? FOUND_AT : step ? step.hiA : before.hi);
  const deadFrom = step ? (step.dir === 'right' ? pos(step.lo) : pos(step.hiA)) : 0;
  const deadTo = step ? (step.dir === 'right' ? pos(step.loA) : pos(step.hi)) : 0;

  /** a range one index wide must still be a visible object — and the final
   * single item is the payoff of the whole reel, so it gets a real marker */
  const seg = (from: number, to: number, floor = 6) => ({
    left: BARS_X + Math.min(from, to) - (Math.abs(to - from) < floor ? floor / 2 : 0),
    width: Math.max(floor, Math.abs(to - from)),
  });
  const live = seg(liveFrom, liveTo, done ? 30 : 6);
  const dead = seg(deadFrom, deadTo);

  const stepsDone = STEPS.filter((s) => frame >= s.start + s.dur * CUT_AT).length;

  const chip = done
    ? {text: `found at ${group(FOUND_AT)} · ${STEP_COUNT} steps`, tone: COLOR.secondary}
    : step
      ? {
          text: `mid ${group(step.mid)} ${step.dir === 'right' ? '<' : '≥'} target · keep ${step.dir}`,
          tone: COLOR.primary,
        }
      : {text: `${group(N)} sorted ids · target ${group(TARGET)}`, tone: COLOR.text3};

  const activeLine = done
    ? CODE_DONE_LINE
    : step
      ? p < CUT_AT
        ? CODE_MID_LINE
        : step.line
      : CODE_INTRO_LINE;
  const codeScroll =
    (CODE.length - VISIBLE_LINES) *
    interpolate(frame, [SEARCH_END - 8, SEARCH_END + 4], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: ease,
    });

  return (
    <ReelFrame
      eyebrow={`Searching · ${Math.round(durationInFrames / fps)} seconds`}
      hookLines={HOOK}
      badges={[
        {value: 'O(log n)', label: 'time', tone: 'primary'},
        {value: 'O(1)', label: 'space', tone: 'secondary'},
      ]}
      code={{lines: CODE, activeLine, scroll: codeScroll}}
      progress={frame / durationInFrames}
    >
      {sfxStyle !== 'silent' && (
        <SfxTrack events={reelSfxEvents(binarySearchReel, sfxStyle)} style={sfxStyle} />
      )}

      {/* ---- lo / mid / hi ---- */}
      <Readout col={0} label="lo" value={group(shown.lo)} tone={COLOR.secondary} opacity={introIn} />
      <Readout
        col={1}
        label="mid"
        value={step ? group(step.mid) : '—'}
        tone={step ? COLOR.primary : COLOR.text4}
        opacity={introIn * (step ? 1 - 0.55 * cut : 1)}
      />
      <Readout col={2} label="hi" value={group(shown.hi)} tone={COLOR.secondary} opacity={introIn} />

      {/* ---- range bar ---- */}
      <div
        style={{
          position: 'absolute',
          left: BARS_X,
          top: BAR_TOP,
          width: BARS_W,
          height: BAR_H,
          borderRadius: 14,
          background: COLOR.surfaceRaised,
          border: `2px solid ${COLOR.border}`,
          boxSizing: 'border-box',
          opacity: introIn,
        }}
      />
      {/* the half being eliminated fades out in place */}
      {step ? (
        <div
          style={{
            position: 'absolute',
            left: dead.left,
            top: BAR_TOP + 4,
            width: dead.width,
            height: BAR_H - 8,
            borderRadius: 10,
            background: `linear-gradient(180deg, ${COLOR.primary}, ${COLOR.primary}CC)`,
            opacity: (1 - cut) * 0.85 * introIn,
          }}
        />
      ) : null}
      {/* the surviving range */}
      <div
        style={{
          position: 'absolute',
          left: live.left,
          top: BAR_TOP + 4,
          width: live.width,
          height: BAR_H - 8,
          borderRadius: 10,
          background: done
            ? `linear-gradient(180deg, ${COLOR.secondary}, ${COLOR.secondary}CC)`
            : `linear-gradient(180deg, ${COLOR.primary}, ${COLOR.primary}CC)`,
          boxShadow: done
            ? `0 0 ${22 * lockPulse}px ${COLOR.secondary}77`
            : `0 0 18px ${COLOR.primary}55`,
          opacity: introIn,
        }}
      />
      {/* mid marker */}
      {step ? (
        <div
          style={{
            position: 'absolute',
            left: BARS_X + pos(step.mid) - 3,
            top: BAR_TOP - 12,
            width: 6,
            height: BAR_H + 24,
            borderRadius: 3,
            background: COLOR.text1,
            opacity: introIn * (1 - cut),
          }}
        />
      ) : null}

      {/* Zoom factor — the bar's UNITS, so it belongs to the bar and nothing
          else. It used to sit on its own line under the bar, 14 px above the
          TARGET caption, where the two right-aligned lines read as one block.
          It now rides inside the bar's top-right corner on a canvas plate (the
          same treatment BarSort gives a label that may cross a filled shape),
          which leaves the whole 44 px between the bar and the magnitude row
          empty and keeps the caption unambiguously attached to what it
          describes. Painted last, so it also wins over the mid marker. */}
      <div
        style={{
          position: 'absolute',
          left: BARS_X + ZOOM_INSET,
          top: BAR_TOP + ZOOM_INSET,
          width: BARS_W - 2 * ZOOM_INSET,
          height: ZOOM_H,
          display: 'flex',
          justifyContent: 'flex-end',
          opacity: introIn,
        }}
      >
        <span
          style={{
            height: ZOOM_H,
            lineHeight: `${ZOOM_H}px`,
            padding: '0 10px',
            borderRadius: 8,
            background: `${COLOR.canvas}E6`,
            fontFamily: FONT_MONO,
            fontSize: TYPE.eyebrow - 4,
            fontWeight: 500,
            color: COLOR.text3,
            whiteSpace: 'nowrap',
          }}
        >
          {done
            ? `1 of ${group(N)}`
            : magnification > 1.5
              ? `zoom ×${group(magnification)}`
              : 'full range'}
        </span>
      </div>

      {/* ---- magnitude band: what is still in play, and what we are after ---- */}
      {(
        [
          {
            label: 'still in range',
            value: group(size),
            tone: done ? COLOR.secondary : COLOR.primary,
            align: 'left' as const,
          },
          {label: 'target', value: group(TARGET), tone: COLOR.text1, align: 'right' as const},
        ]
      ).map((c, i) => (
        <React.Fragment key={c.label}>
          <div
            style={{
              position: 'absolute',
              left: BARS_X + i * (BARS_W / 2),
              top: MAG_LABEL_TOP,
              width: BARS_W / 2,
              height: 26,
              lineHeight: '26px',
              textAlign: c.align,
              fontFamily: FONT_SANS,
              fontSize: TYPE.eyebrow - 2,
              fontWeight: 800,
              letterSpacing: 2.6,
              textTransform: 'uppercase',
              color: COLOR.text4,
              opacity: introIn,
            }}
          >
            {c.label}
          </div>
          <div
            style={{
              position: 'absolute',
              left: BARS_X + i * (BARS_W / 2),
              top: MAG_VALUE_TOP,
              width: BARS_W / 2,
              height: 58,
              lineHeight: '58px',
              textAlign: c.align,
              fontFamily: FONT_MONO,
              fontSize: 52,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: c.tone,
              opacity: introIn,
            }}
          >
            {c.value}
          </div>
        </React.Fragment>
      ))}

      {/* ---- step ladder: the hook's "20 steps", as 20 objects ---- */}
      {STEPS.map((s, i) => {
        const filled = i < stepsDone;
        const current = i === stepsDone && !done;
        return (
          <div
            key={`tick-${s.k}`}
            style={{
              position: 'absolute',
              left: BARS_X + i * (TICK_W + LADDER_GAP),
              top: LADDER_TOP,
              width: TICK_W,
              height: 16,
              borderRadius: 8,
              background: filled ? COLOR.secondary : current ? COLOR.primary : COLOR.surfaceRaised,
              opacity: introIn * (filled ? 0.95 : current ? 0.95 : 0.65),
            }}
          />
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: BARS_X,
          top: LADDER_CAPTION_TOP,
          width: BARS_W,
          height: 30,
          lineHeight: '30px',
          textAlign: 'center',
          fontFamily: FONT_MONO,
          fontSize: TYPE.eyebrow,
          fontWeight: 500,
          color: COLOR.text3,
          opacity: introIn,
        }}
      >
        {`log2(${group(N)}) = ${STEP_COUNT} halvings`}
      </div>

      {/* ---- chip (template position) ---- */}
      <div
        style={{
          position: 'absolute',
          left: ZONE.cardX,
          top: STAGE.chipTop,
          width: ZONE.cardW,
          display: 'flex',
          justifyContent: 'center',
          opacity: introIn,
        }}
      >
        <div
          style={{
            height: STAGE.chipH,
            display: 'flex',
            alignItems: 'center',
            padding: '0 26px',
            borderRadius: 16,
            border: `2px solid ${chip.tone}66`,
            background: COLOR.surface,
            fontFamily: FONT_MONO,
            fontSize: TYPE.chip,
            fontWeight: 600,
            color: chip.tone,
            whiteSpace: 'nowrap',
          }}
        >
          {chip.text}
        </div>
      </div>

      {/* ---- counters (template position) ---- */}
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
          opacity: introIn,
        }}
      >
        <span>
          steps{' '}
          <span style={{color: COLOR.primary, fontVariantNumeric: 'tabular-nums'}}>{stepsDone}</span>
          <span style={{color: COLOR.text4}}>/{STEP_COUNT}</span>
        </span>
        <span>
          range{' '}
          <span style={{color: COLOR.secondary, fontVariantNumeric: 'tabular-nums'}}>
            {group(size)}
          </span>
        </span>
      </div>
    </ReelFrame>
  );
};
