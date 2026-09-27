/**
 * Scene — breadth-first search.
 *
 * The hook is "BFS doesn't search. It spreads.", so the reel has to EARN the
 * word "spreads": the layer count, the visit order, the queue contents at every
 * frame and even the node LAYOUT are outputs of a real breadth-first traversal
 * run at module load, not an authored storyboard. A node's column is its
 * computed distance from the source and its row is its position in the real
 * visit order — if an edge is ever added to `ADJ`, the picture re-arranges
 * itself rather than lying about the algorithm.
 *
 * The one deliberate visual liberty is the ripple: the whoosh fires when the
 * edge is taken (`at`) and the neighbour lights up TRAVEL frames later, when
 * the wave arrives. That is what makes the spread readable as a wave instead of
 * as twelve independent pops, and the sound leading the arrival by 0.4 s is how
 * a swap sound behaves in every other scene here.
 *
 * React-free: imported by the Node scripts through the ts-register hook.
 */

import type {RawSfxEvent} from '../audio/sfxEvents';
import type {ReelSource} from '../timeline/spec';

export const SOURCE = 'A';

/**
 * Undirected, 12 nodes, 16 edges. Written as adjacency lists because that is
 * what the code panel shows; the symmetry is asserted below so a typo becomes a
 * module-load error rather than a wrong picture.
 *
 * C-D and I-J are intra-layer edges on purpose: they are the "already
 * discovered, skip it" case, which is the half of BFS a tree drawing hides.
 */
export const ADJ: Record<string, string[]> = {
  A: ['B', 'C', 'D'],
  B: ['A', 'E', 'F'],
  C: ['A', 'D', 'F', 'G'],
  D: ['A', 'C', 'G'],
  E: ['B', 'H'],
  F: ['B', 'C', 'I'],
  G: ['C', 'D', 'J'],
  H: ['E', 'K'],
  I: ['F', 'J', 'K'],
  J: ['G', 'I', 'L'],
  K: ['H', 'I'],
  L: ['J'],
};

export const NODES = Object.keys(ADJ);

for (const u of NODES) {
  for (const v of ADJ[u]) {
    if (!ADJ[v]?.includes(u)) throw new Error(`bfs: edge ${u}-${v} is not symmetric`);
  }
}

/** deduped undirected edge list, in adjacency order */
export const EDGES: [string, string][] = (() => {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const u of NODES) {
    for (const v of ADJ[u]) {
      const k = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([u, v]);
    }
  }
  return out;
})();

export const edgeKey = (u: string, v: string) => (u < v ? `${u}|${v}` : `${v}|${u}`);

// ------------------------------------------------------------------ the run

type Visit = {node: string; layer: number; discoveries: string[]; scanned: string[]};

const run = () => {
  const dist: Record<string, number> = {[SOURCE]: 0};
  const q: string[] = [SOURCE];
  const order: Visit[] = [];
  let head = 0;
  while (head < q.length) {
    const u = q[head++];
    const discoveries: string[] = [];
    const scanned: string[] = [];
    for (const v of ADJ[u]) {
      scanned.push(v);
      if (dist[v] === undefined) {
        dist[v] = dist[u] + 1;
        q.push(v);
        discoveries.push(v);
      }
    }
    order.push({node: u, layer: dist[u], discoveries, scanned});
  }
  return {dist, order};
};

const {dist: DIST_MAP, order: VISITS} = run();

if (VISITS.length !== NODES.length) {
  throw new Error('bfs: the graph is not connected — every node must be reachable');
}

export const DIST = DIST_MAP;

/** nodes grouped by computed distance, each layer in real visit order */
export const LAYERS: string[][] = (() => {
  const out: string[][] = [];
  for (const v of VISITS) (out[v.layer] ??= []).push(v.node);
  return out;
})();
export const LAYER_COUNT = LAYERS.length;

// ---------------------------------------------------------------- the layout

/** stage-card inner box, shared with every other scene */
const COL_X = 88;
const COL_W = 784;
/** three rows is the deepest layer, so this is what sets the node radius */
const ROW_CENTRE = 708;
const ROW_GAP = 104;
export const NODE_R = 42;

/** column = computed distance, row = position in the real visit order */
export const POS: Record<string, {x: number; y: number}> = (() => {
  const out: Record<string, {x: number; y: number}> = {};
  LAYERS.forEach((names, li) => {
    const x = COL_X + (COL_W * (li + 0.5)) / LAYER_COUNT;
    names.forEach((n, i) => {
      out[n] = {x, y: ROW_CENTRE + (i - (names.length - 1) / 2) * ROW_GAP};
    });
  });
  return out;
})();

// ----------------------------------------------------------------- the clock

const INTRO = 45;
/** the first four dequeues are slow enough to read the rule off the screen */
const SLOW_VISITS = 4;
const SLOW_DUR = 30;
const FAST_DUR = 22;
/** fraction of a visit spent before the first ripple leaves the node */
const RIPPLE_OFFSET = 0.22;
/** frames between two ripples leaving the same node */
const RIPPLE_STAGGER = 9;
/** frames a ripple takes to cross an edge — also the neighbour's light-up delay */
export const TRAVEL = 12;
const FINAL_GAP = 22;
const OUTRO = FINAL_GAP + 62;

export type Ripple = {to: string; at: number};

export type BfsPhase = {
  /** dequeue index, 0-based */
  idx: number;
  node: string;
  layer: number;
  start: number;
  dur: number;
  /** queue contents right after `node` was popped, before its own discoveries */
  queueBase: string[];
  ripples: Ripple[];
  scanned: string[];
  /** last dequeue of its layer: the layer is fully visited when this ends */
  layerEnd: boolean;
};

export const PHASES: BfsPhase[] = (() => {
  const out: BfsPhase[] = [];
  const q: string[] = [SOURCE];
  let head = 0;
  let t = INTRO;
  VISITS.forEach((v, idx) => {
    const dur = idx < SLOW_VISITS ? SLOW_DUR : FAST_DUR;
    head++;
    const queueBase = q.slice(head);
    const ripples = v.discoveries.map((to, j) => ({
      to,
      at: t + Math.round(dur * RIPPLE_OFFSET) + j * RIPPLE_STAGGER,
    }));
    q.push(...v.discoveries);
    const next = VISITS[idx + 1];
    out.push({
      idx,
      node: v.node,
      layer: v.layer,
      start: t,
      dur,
      queueBase,
      ripples,
      scanned: v.scanned,
      layerEnd: !next || next.layer !== v.layer,
    });
    t += dur;
  });
  return out;
})();

export const SCENE_END = PHASES[PHASES.length - 1].start + PHASES[PHASES.length - 1].dur;
export const FINAL_AT = SCENE_END + FINAL_GAP;
export const TOTAL = SCENE_END + OUTRO;

/** every (parent -> child) edge the traversal actually used */
export const TREE_EDGES = new Set(
  PHASES.flatMap((p) => p.ripples.map((r) => edgeKey(p.node, r.to)))
);

/** the discovery frame of every node — when it lights up, not when it is popped */
export const DISCOVERED_AT: Record<string, number> = (() => {
  const out: Record<string, number> = {[SOURCE]: INTRO};
  for (const p of PHASES) for (const r of p.ripples) out[r.to] = r.at + TRAVEL;
  return out;
})();

// ------------------------------------------------------------------ the code

export const CODE = [
  'q, vis = deque([src]), {src}',
  'while q:',
  '  u = q.popleft()',
  '  for v in graph[u]:',
  '    if v not in vis: vis.add(v); q += [v]',
  `# ${NODES.length} nodes, ${LAYER_COUNT} layers, nearest first`,
];
export const CODE_INTRO_LINE = 1;
export const CODE_POP_LINE = 3;
export const CODE_SCAN_LINE = 4;
export const CODE_PUSH_LINE = 5;
export const CODE_DONE_LINE = 6;

export const HOOK = [{text: "BFS doesn't search."}, {text: 'It ', accent: 'spreads.'}];

/**
 * Sound mapping:
 *   compare  a dequeue — the beat where the algorithm reads and nothing moves
 *   swap     a ripple leaves along an edge: the only real movement in the scene
 *   lock     a LAYER is fully visited. This is the scene's whole argument (BFS
 *            finishes a distance before it starts the next one), so it gets the
 *            lock sound, exactly as a locked slot does in the bar sort.
 *   final    closing chime
 *
 * The calm schedule thins the dequeue ticks on its own (24-frame minimum gap
 * against a 22-frame cadence), which is intended: the audible rhythm should be
 * the spread, not the bookkeeping.
 *
 * RIPPLE_GAIN is a measured correction, not taste: a node with three edges
 * fires three swap sounds 0.3 s apart and the layer lock lands on their tails.
 * Trimming the RIPPLE rather than the whole scene keeps the lock the loudest
 * thing in the bar — the point of the accent — and keeps the render under the
 * style's true-peak ceiling.
 */
const RIPPLE_GAIN = 0.7;

export const events = (): RawSfxEvent[] => {
  const out: RawSfxEvent[] = [];
  for (const p of PHASES) {
    out.push({kind: 'compare', frame: p.start});
    for (const r of p.ripples) out.push({kind: 'swap', frame: r.at, volume: RIPPLE_GAIN});
    if (p.layerEnd) out.push({kind: 'lock', frame: p.start + p.dur - 1});
  }
  out.push({kind: 'final', frame: FINAL_AT});
  return out;
};

export const bfsReel: ReelSource = {
  compositionId: 'BreadthFirstSearch',
  outFile: 'bfs',
  aliases: ['bfs', 'breadth-first-search'],
  gain: 0.9,
  timeline: () => ({total: TOTAL, events: events()}),
};
