import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {COLOR, SAFE, STAGE, TYPE, ZONE} from '../theme';
import {FONT_SANS} from '../fonts';
import {CodePanel, CodePanelProps} from './CodePanel';
import {Watermark} from './Watermark';

export type Badge = {
  /** Big-O expression, e.g. "O(n²)" */
  value: string;
  /** small caption, e.g. "time" */
  label: string;
  tone: 'primary' | 'secondary';
};

export type ReelFrameProps = {
  eyebrow: string;
  /** Hook lines, max 2. A line may carry an accent segment. */
  hookLines: {text: string; accent?: string}[];
  badges: Badge[];
  code: CodePanelProps;
  /** 0..1 timeline progress, drives the scrubber under the stage. */
  progress: number;
  /** stage content, absolutely positioned in reel coordinates */
  children?: React.ReactNode;
};

/**
 * The binding reel layout. Every critical element is placed from
 * the SAFE/ZONE/STAGE tokens in theme.ts, so the whole composition sits inside
 * x:[60,900] y:[230,1400]. The decorative layer (canvas fill, grid, radial
 * wash, vignette) deliberately covers the full 1080x1920 so the frame never
 * reads as letterboxed behind the platform chrome.
 */
export const ReelFrame: React.FC<ReelFrameProps> = ({
  eyebrow,
  hookLines,
  badges,
  code,
  progress,
  children,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const intro = spring({frame, fps, config: {damping: 200}, durationInFrames: 24});
  const p = Math.min(1, Math.max(0, progress));

  return (
    <AbsoluteFill style={{background: COLOR.canvas, fontFamily: FONT_SANS}}>
      {/* ---------- DECORATIVE LAYER — full bleed, never carries meaning ---------- */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${COLOR.border}55 1px, transparent 1px), linear-gradient(90deg, ${COLOR.border}55 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
          opacity: 0.7,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(72% 34% at 50% 15%, ${COLOR.primary}1C 0%, transparent 66%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(84% 30% at 50% 86%, ${COLOR.secondary}16 0%, transparent 72%)`,
        }}
      />
      {/* edge vignette — soft, so the out-of-safe band still carries texture
          instead of reading as a letterbox */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${COLOR.canvas}CC 0%, transparent 9%, transparent 91%, ${COLOR.canvas}AA 100%)`,
        }}
      />

      {/* ---------- HOOK BAND (y 232 -> 502) ---------- */}
      <div
        style={{
          position: 'absolute',
          left: ZONE.pad,
          top: ZONE.eyebrowTop,
          height: ZONE.eyebrowH,
          lineHeight: `${ZONE.eyebrowH}px`,
          fontSize: TYPE.eyebrow,
          fontWeight: 800,
          letterSpacing: 3.2,
          color: COLOR.text3,
          textTransform: 'uppercase',
          opacity: intro,
        }}
      >
        {eyebrow}
      </div>

      {/* coral rule with end dot — stops at the safe right edge */}
      <div style={{position: 'absolute', left: ZONE.pad, top: ZONE.ruleTop, opacity: intro}}>
        <div
          style={{
            width: (SAFE.width - 10) * intro,
            height: 3,
            borderRadius: 2,
            background: `linear-gradient(90deg, ${COLOR.primary}, ${COLOR.primary}55)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: (SAFE.width - 10) * intro - 5,
            top: -6,
            width: 15,
            height: 15,
            borderRadius: 8,
            background: COLOR.primary,
          }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          left: ZONE.pad,
          top: ZONE.hookTop,
          width: SAFE.width,
          height: ZONE.hookH,
          fontSize: TYPE.hook,
          fontWeight: 800,
          lineHeight: 1.04,
          letterSpacing: -1.8,
          color: COLOR.text1,
        }}
      >
        {hookLines.slice(0, 2).map((l, i) => (
          <div
            key={i}
            style={{
              whiteSpace: 'nowrap',
              opacity: spring({
                frame: frame - 4 - i * 5,
                fps,
                config: {damping: 200},
                durationInFrames: 22,
              }),
            }}
          >
            {l.text}
            {l.accent ? <span style={{color: COLOR.primary}}>{l.accent}</span> : null}
          </div>
        ))}
      </div>

      {/* Big-O pills */}
      <div
        style={{
          position: 'absolute',
          left: ZONE.pad,
          top: ZONE.badgeTop,
          height: ZONE.badgeH,
          display: 'flex',
          gap: 18,
          opacity: spring({frame: frame - 12, fps, config: {damping: 200}, durationInFrames: 22}),
        }}
      >
        {badges.map((b) => {
          const tone = b.tone === 'primary' ? COLOR.primary : COLOR.secondary;
          return (
            <div
              key={b.label}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 9,
                height: ZONE.badgeH,
                padding: '0 22px',
                boxSizing: 'border-box',
                borderRadius: 18,
                border: `3px solid ${tone}`,
                background: `${tone}14`,
              }}
            >
              <span
                style={{
                  fontSize: TYPE.badge,
                  lineHeight: `${ZONE.badgeH - 6}px`,
                  fontWeight: 800,
                  color: COLOR.text1,
                }}
              >
                {b.value}
              </span>
              <span style={{fontSize: TYPE.badgeLabel, fontWeight: 700, color: tone}}>
                {b.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* ---------- STAGE CARD (y 514 -> 1092) ---------- */}
      <div
        style={{
          position: 'absolute',
          left: ZONE.cardX,
          top: ZONE.stageTop,
          width: ZONE.cardW,
          height: ZONE.stageH,
          borderRadius: 28,
          border: `2px solid ${COLOR.border}`,
          background: `${COLOR.canvas}B8`,
          overflow: 'hidden',
        }}
      >
        {/* denser grid inside the card so the stage reads as its own surface */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `linear-gradient(${COLOR.border}66 1px, transparent 1px), linear-gradient(90deg, ${COLOR.border}66 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
            opacity: 0.5,
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(90% 55% at 50% 0%, ${COLOR.primary}12 0%, transparent 70%)`,
          }}
        />
      </div>

      {/* stage children live in reel coordinates, above the card */}
      {children}

      {/* scrubber, mirrors the template's player affordance (inside the card) */}
      <div
        style={{
          position: 'absolute',
          left: ZONE.cardX + STAGE.innerPad,
          top: STAGE.scrubTop,
          width: ZONE.cardW - 2 * STAGE.innerPad,
          height: STAGE.scrubH,
          borderRadius: STAGE.scrubH / 2,
          background: COLOR.surfaceRaised,
        }}
      >
        <div
          style={{
            width: `${p * 100}%`,
            height: STAGE.scrubH,
            borderRadius: STAGE.scrubH / 2,
            background: COLOR.primary,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `${p * 100}%`,
            top: -7,
            width: 22,
            height: 22,
            marginLeft: -11,
            borderRadius: 11,
            background: COLOR.primary,
            boxShadow: `0 0 20px ${COLOR.primary}99`,
          }}
        />
      </div>

      {/* ---------- CODE PANEL (y 1102 -> 1340) ---------- */}
      <CodePanel {...code} />

      {/* ---------- WATERMARK (bottom-LEFT, y 1350 -> 1394) ---------- */}
      <Watermark />
    </AbsoluteFill>
  );
};
