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
  CODE_POP_LINE,
  CODE_PUSH_LINE,
  CODE_SCAN_LINE,
  DISCOVERED_AT,
  DIST,
  EDGES,
  HOOK,
  LAYERS,
  LAYER_COUNT,
  NODES,
  NODE_R,
  PHASES,
  POS,
  SCENE_END,
  SOURCE,
  TRAVEL,
  TREE_EDGES,
  bfsReel,
  edgeKey,
} from '../scenes/bfs';

/**
 * Breadth-first search as a spreading wave.
 *
 * Vertical budget inside the stage card (y 514-1092):
 *   524-550  column heads
 *   556-860  the graph: five layer ribbons, 16 edges, 12 nodes (r = 42)
 *   876-932  the QUEUE lane — the real deque contents at this frame
 *   960+     chip / counters / scrubber (template positions)
 *
 * The 44 px "value" slot the template requires is spent on the node labels, which
 * are the data a viewer has to read. The queue chips are 36 px: the lane is a
 * readout of the SAME twelve labels in a second place, and five 44 px chips plus
 * their lane label do not fit across the 784 px inner width without shrinking
 * the graph.
 */

const BARS_X = ZONE.cardX + STAGE.innerPad; // 88
const BARS_W = ZONE.cardW - 2 * STAGE.innerPad; // 784

const HEAD_TOP = 524;
const GRAPH_TOP = 556;
const GRAPH_BOTTOM = 860;
const RIBBON_HALF = 58;

const QUEUE_TOP = 876;
const QUEUE_H = 56;
const QUEUE_LABEL_W = 124;
const CHIP_W = 66;
const CHIP_H = 44;
const CHIP_GAP = 10;

const ease = Easing.inOut(Easing.cubic);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const BreadthFirstSearch: React.FC<{sfxStyle: SfxStyle | 'silent'}> = ({sfxStyle}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  // ---- which dequeue is on screen ----
  let phase: (typeof PHASES)[number] | null = null;
  for (const p of PHASES) if (frame >= p.start) phase = p;
  const done = frame >= SCENE_END;
  const active = done ? null : phase;
  const p = active ? clamp01((frame - active.start) / active.dur) : 0;

  // ---- node state at this frame ----
  const discovered = (n: string) => frame >= (DISCOVERED_AT[n] ?? Infinity);
  const dequeuedAt: Record<string, number> = {};
  for (const ph of PHASES) dequeuedAt[ph.node] = ph.start;
  const popped = (n: string) => frame >= dequeuedAt[n];
  const visitedCount = PHASES.filter((ph) => frame >= ph.start + ph.dur).length;

  /** a layer is violet once every one of its nodes has been dequeued */
  const layerDone = LAYERS.map((names) => names.every((n) => frame >= dequeuedAt[n] + 1));

  // ---- ripples in flight ----
  const flying = PHASES.flatMap((ph) =>
    ph.ripples
      .filter((r) => frame >= r.at && frame < r.at + TRAVEL)
      .map((r) => ({from: ph.node, to: r.to, t: ease(clamp01((frame - r.at) / TRAVEL))}))
  );
  const flyingKeys = new Set(flying.map((f) => edgeKey(f.from, f.to)));

  // ---- the live queue ----
  const queue = active
    ? [...active.queueBase, ...active.ripples.filter((r) => frame >= r.at + TRAVEL).map((r) => r.to)]
    : done
      ? []
      : [SOURCE];

  const introIn = spring({frame, fps, config: {damping: 200}, durationInFrames: 24});
  const donePulse = done
    ? 1 + 0.35 * Math.sin((frame - SCENE_END) * 0.45) * Math.exp(-(frame - SCENE_END) * 0.07)
    : 1;

  const newlyQueued = active?.ripples.filter((r) => frame >= r.at + TRAVEL).map((r) => r.to) ?? [];
  const chip = done
    ? {
        text: `${NODES.length} nodes · ${LAYER_COUNT} layers · nearest first`,
        tone: COLOR.secondary,
      }
    : active
      ? newlyQueued.length
        ? {
            text: `visit ${active.node} · reach ${newlyQueued.join(', ')}`,
            tone: COLOR.primary,
          }
        : {text: `visit ${active.node} · layer ${active.layer}`, tone: COLOR.primary}
      : {text: `${NODES.length} nodes · start at ${SOURCE}`, tone: COLOR.text3};

  const activeLine = done
    ? CODE_DONE_LINE
    : active
      ? p < 0.2
        ? CODE_POP_LINE
        : active.ripples.length && frame >= active.ripples[0].at
          ? CODE_PUSH_LINE
          : CODE_SCAN_LINE
      : CODE_INTRO_LINE;
  const codeScroll =
    (CODE.length - VISIBLE_LINES) *
    interpolate(frame, [SCENE_END - 8, SCENE_END + 4], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: ease,
    });

  return (
    <ReelFrame
      eyebrow={`Graphs · ${Math.round(durationInFrames / fps)} seconds`}
      hookLines={HOOK}
      badges={[
        {value: 'O(V+E)', label: 'time', tone: 'primary'},
        {value: 'O(V)', label: 'space', tone: 'secondary'},
      ]}
      code={{lines: CODE, activeLine, scroll: codeScroll}}
      progress={frame / durationInFrames}
    >
      {sfxStyle !== 'silent' && (
        <SfxTrack events={reelSfxEvents(bfsReel, sfxStyle)} style={sfxStyle} />
      )}

      {/* ---- column heads ---- */}
      <div
        style={{
          position: 'absolute',
          left: BARS_X,
          top: HEAD_TOP,
          width: BARS_W,
          height: 26,
          lineHeight: '26px',
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: FONT_SANS,
          fontSize: TYPE.eyebrow - 2,
          fontWeight: 800,
          letterSpacing: 2.6,
          textTransform: 'uppercase',
          color: COLOR.text4,
          opacity: introIn,
        }}
      >
        <span>{done ? 'all layers reached' : `layer ${active ? active.layer : 0}`}</span>
        <span>{`${NODES.length} nodes`}</span>
      </div>

      {/* ---- layer ribbons: the wave front, drawn as territory ---- */}
      {LAYERS.map((names, li) => {
        const x = POS[names[0]].x;
        const lit = !done && active?.layer === li;
        const filled = layerDone[li];
        return (
          <div
            key={`ribbon-${li}`}
            style={{
              position: 'absolute',
              left: x - RIBBON_HALF,
              top: GRAPH_TOP,
              width: RIBBON_HALF * 2,
              height: GRAPH_BOTTOM - GRAPH_TOP,
              borderRadius: 26,
              background: filled ? `${COLOR.secondary}12` : lit ? `${COLOR.primary}12` : 'transparent',
              opacity: introIn,
            }}
          />
        );
      })}

      {/* ---- edges ---- */}
      {EDGES.map(([u, v]) => {
        const a = POS[u];
        const b = POS[v];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        const key = edgeKey(u, v);
        const isTree = TREE_EDGES.has(key);
        /** on a tree edge the child is the deeper endpoint; it is lit once the
         * ripple has arrived there, which is exactly `discovered` */
        const crossed = isTree && discovered(DIST[u] > DIST[v] ? u : v);
        const inFlight = flyingKeys.has(key);
        const tone = inFlight ? COLOR.primary : crossed ? COLOR.secondary : COLOR.border;
        const thick = inFlight ? 7 : crossed ? 5 : 3;
        return (
          <div
            key={`edge-${key}`}
            style={{
              position: 'absolute',
              left: (a.x + b.x) / 2 - len / 2,
              top: (a.y + b.y) / 2 - thick / 2,
              width: len,
              height: thick,
              borderRadius: thick / 2,
              background: tone,
              transform: `rotate(${angle}deg)`,
              opacity: introIn * (inFlight ? 1 : crossed ? 0.85 : 0.55),
            }}
          />
        );
      })}

      {/* ---- nodes ---- */}
      {NODES.map((n) => {
        const {x, y} = POS[n];
        const isDiscovered = discovered(n);
        const isPopped = popped(n);
        const isActive = !done && active?.node === n;
        const tone = isPopped && !isActive ? COLOR.secondary : isDiscovered ? COLOR.primary : COLOR.border;
        const fill = isActive
          ? COLOR.primary
          : isPopped
            ? `${COLOR.secondary}1F`
            : isDiscovered
              ? `${COLOR.primary}1F`
              : `${COLOR.surface}E6`;
        const ring = isActive ? 1 + 0.06 * Math.sin((frame - (active?.start ?? 0)) * 0.42) : 1;
        return (
          <div
            key={`node-${n}`}
            style={{
              position: 'absolute',
              left: x - NODE_R,
              top: y - NODE_R,
              width: NODE_R * 2,
              height: NODE_R * 2,
              borderRadius: NODE_R,
              boxSizing: 'border-box',
              border: `${isActive ? 5 : 3}px solid ${tone}`,
              background: fill,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: FONT_MONO,
              fontSize: TYPE.value,
              fontWeight: 700,
              color: isActive ? COLOR.primaryInk : isDiscovered ? COLOR.text1 : COLOR.text4,
              transform: `scale(${isActive ? ring : 1})`,
              boxShadow: isActive
                ? `0 0 16px ${COLOR.primary}88`
                : isPopped && done
                  ? `0 0 ${10 * donePulse}px ${COLOR.secondary}55`
                  : 'none',
              opacity: introIn,
            }}
          >
            {n}
          </div>
        );
      })}

      {/* ---- the wave itself: a ripple crossing an edge ---- */}
      {flying.map((f) => {
        const a = POS[f.from];
        const b = POS[f.to];
        const x = a.x + (b.x - a.x) * f.t;
        const y = a.y + (b.y - a.y) * f.t;
        return (
          <div
            key={`ripple-${f.from}-${f.to}`}
            style={{
              position: 'absolute',
              left: x - 11,
              top: y - 11,
              width: 22,
              height: 22,
              borderRadius: 11,
              background: COLOR.primary,
              boxShadow: `0 0 18px ${COLOR.primary}AA`,
              opacity: introIn * (1 - 0.3 * f.t),
            }}
          />
        );
      })}

      {/* ---- the queue lane ---- */}
      <div
        style={{
          position: 'absolute',
          left: BARS_X,
          top: QUEUE_TOP,
          width: BARS_W,
          height: QUEUE_H,
          boxSizing: 'border-box',
          borderRadius: 16,
          border: `2px solid ${COLOR.border}`,
          background: `${COLOR.surface}CC`,
          opacity: introIn,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: BARS_X + 20,
          top: QUEUE_TOP,
          width: QUEUE_LABEL_W,
          height: QUEUE_H,
          lineHeight: `${QUEUE_H}px`,
          fontFamily: FONT_SANS,
          fontSize: TYPE.eyebrow - 2,
          fontWeight: 800,
          letterSpacing: 2.6,
          textTransform: 'uppercase',
          color: COLOR.text4,
          opacity: introIn,
        }}
      >
        queue
      </div>
      {queue.length === 0 ? (
        <div
          style={{
            position: 'absolute',
            left: BARS_X + QUEUE_LABEL_W + 20,
            top: QUEUE_TOP,
            height: QUEUE_H,
            lineHeight: `${QUEUE_H}px`,
            fontFamily: FONT_MONO,
            fontSize: TYPE.chip,
            fontWeight: 500,
            color: done ? COLOR.secondary : COLOR.text4,
            opacity: introIn,
          }}
        >
          {done ? 'empty — every node reached' : 'empty'}
        </div>
      ) : null}
      {queue.map((n, i) => (
        <div
          key={`q-${n}`}
          style={{
            position: 'absolute',
            left: BARS_X + QUEUE_LABEL_W + 20 + i * (CHIP_W + CHIP_GAP),
            top: QUEUE_TOP + (QUEUE_H - CHIP_H) / 2,
            width: CHIP_W,
            height: CHIP_H,
            lineHeight: `${CHIP_H}px`,
            textAlign: 'center',
            boxSizing: 'border-box',
            borderRadius: 12,
            border: `3px solid ${i === 0 ? COLOR.primary : `${COLOR.primary}88`}`,
            background: `${COLOR.primary}1F`,
            fontFamily: FONT_MONO,
            fontSize: 36,
            fontWeight: 700,
            color: COLOR.text1,
            opacity: introIn,
          }}
        >
          {n}
        </div>
      ))}

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
          visited{' '}
          <span style={{color: COLOR.secondary, fontVariantNumeric: 'tabular-nums'}}>
            {visitedCount}
          </span>
          <span style={{color: COLOR.text4}}>/{NODES.length}</span>
        </span>
        <span>
          layer{' '}
          <span style={{color: COLOR.primary, fontVariantNumeric: 'tabular-nums'}}>
            {done ? LAYER_COUNT - 1 : (active?.layer ?? 0)}
          </span>
          <span style={{color: COLOR.text4}}>/{LAYER_COUNT - 1}</span>
        </span>
      </div>
    </ReelFrame>
  );
};
