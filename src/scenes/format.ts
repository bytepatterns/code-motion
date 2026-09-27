/**
 * Number formatting shared by the scenes.
 *
 * Deliberately NOT `toLocaleString`: Remotion renders inside Chromium and the
 * verification scripts run in Node, and a reel whose hook quotes a number must
 * produce the exact same string in both. A regex grouper has no ICU, no locale
 * and no version drift.
 */
export const group = (n: number): string =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
