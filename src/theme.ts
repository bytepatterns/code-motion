/**
 * THEME — the one file to edit to re-skin every scene.
 *
 * COLOR, the type scale and the watermark live here. Nothing in src/ may
 * introduce a colour that is not in COLOR.
 *
 * The default palette is the BytePatterns dark theme. Scenes are always dark on
 * purpose: scripts/verify-layout.mjs treats any pixel brighter than luma 70 as
 * content, so `canvas`, `surface`, `surfaceRaised` and `border` must stay at or
 * under luma 70, and anything a viewer must read must sit above it.
 *
 * SAFE, ZONE and STAGE below are geometry, not style: they are the verified
 * layout contract. Change them only together with scripts/verify-layout.mjs.
 */

export const COLOR = {
  canvas: '#0B0D10',
  surface: '#12161B',
  surfaceRaised: '#1B222A',
  border: '#2B333D',

  text1: '#F7FAFC',
  text2: '#C7D0D9',
  text3: '#9AA7B4',
  text4: '#7B8896',

  /** coral — active / comparison / "what to look at right now" */
  primary: '#FF6B4A',
  primaryInk: '#1A0E0A',
  /** violet — progress / success / sorted-locked */
  secondary: '#B69CFF',
  secondaryInk: '#160F2D',
  warning: '#FFB454',
  warningInk: '#241504',
  error: '#FF758F',
  errorInk: '#2A0B13',
} as const;

/** Reel canvas geometry (1080x1920, 30fps vertical). */
export const REEL = {
  width: 1080,
  height: 1920,
  fps: 30,
} as const;

/**
 * SAFE ZONE — binding, see README.md ("The safe zone").
 * Intersection of the Reels / TikTok / Shorts chrome:
 *   top 230 (camera + title overlays)
 *   bottom 520 (Instagram caption + audio strip, worst case ~500)
 *   left 60 · right 180 (like/comment/share icon rail)
 * => every text, badge, bar, label, counter, code line and the watermark must
 * live inside x:[60,900], y:[230,1400]. Only decorative texture may bleed out.
 */
export const SAFE = {
  left: 60,
  right: 900,
  top: 230,
  bottom: 1400,
  width: 900 - 60, // 840
  height: 1400 - 230, // 1170
} as const;

/**
 * Template bands, all expressed in absolute reel coordinates and all fully
 * contained by SAFE. Vertical budget (1170px):
 *   hook   232 -> 502   (eyebrow, rule, 2 hook lines, Big-O pills)
 *   stage  514 -> 1092  (bars, labels, indices, chip, counters, scrubber)
 *   code  1102 -> 1340  (5-line window, active line coral)
 *   mark  1350 -> 1394  (bottom-LEFT watermark, clear of the icon rail)
 */
export const ZONE = {
  /** left edge / side margin for every critical element */
  pad: SAFE.left,
  /** cards share the full safe width */
  cardX: SAFE.left,
  cardW: SAFE.width,

  eyebrowTop: 232,
  eyebrowH: 32,
  ruleTop: 272,

  hookTop: 284,
  /** 2 lines * (hook 72 * 1.04) = 150 */
  hookH: 150,

  badgeTop: 446,
  badgeH: 56,

  stageTop: 514,
  stageH: 578,

  codeTop: 1102,
  /** 18 padding + 5 rows * 40 + 18 padding */
  codeH: 236,

  markTop: 1350,
  markH: 44,
} as const;

/** Stage internals (absolute reel coordinates, all inside the stage card). */
export const STAGE = {
  innerPad: 28,
  /** bars sit on this line */
  baseline: 900,
  maxBarH: 286,
  /** how high the arcing swap partner may rise — capped so its value label
   * never reaches the Big-O pills at y 502 */
  swapLift: 40,
  /** distance from bar top to the top of its value label */
  labelOffset: 52,
  indexTop: 910,
  lockBarTop: 948,
  chipTop: 960,
  chipH: 56,
  counterTop: 1026,
  scrubTop: 1070,
  scrubH: 8,
} as const;

/** Type scale — watch-distance legibility floor: hook >= 72 px, values >= 44 px. */
export const TYPE = {
  eyebrow: 26,
  hook: 72, // >= 72 required
  badge: 36,
  badgeLabel: 24,
  value: 44, // >= 44 required
  index: 26,
  counter: 30,
  chip: 30,
  legend: 28,
  code: 30,
  codeGutter: 22,
  mark: 28,
} as const;

/**
 * Watermark — bottom-LEFT, inside the safe zone (the bottom-right corner is
 * under the like/comment/share rail on every platform). Put your handle in
 * `text`; `mark` is the short glyph drawn before it in COLOR.primary ('' hides it).
 */
export const WATERMARK: {text: string; mark: string; opacity: number} = {
  text: 'code-motion',
  mark: '</>',
  opacity: 0.6,
};
