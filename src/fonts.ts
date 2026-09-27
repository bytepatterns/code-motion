import {loadFont as loadManrope} from '@remotion/google-fonts/Manrope';
import {loadFont as loadPlexMono} from '@remotion/google-fonts/IBMPlexMono';

/**
 * Both loaders register their own delayRender()/continueRender() handles,
 * so Remotion will not capture a frame before the faces are ready.
 */
const manrope = loadManrope('normal', {
  weights: ['500', '600', '700', '800'],
  subsets: ['latin'],
});

const plexMono = loadPlexMono('normal', {
  weights: ['400', '500', '600'],
  subsets: ['latin'],
});

export const FONT_SANS = `${manrope.fontFamily}, system-ui, sans-serif`;
export const FONT_MONO = `${plexMono.fontFamily}, ui-monospace, Consolas, monospace`;
