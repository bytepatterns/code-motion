/**
 * Style "calm-pad" — "calm" plus a sustained warm bed.
 *
 * This is a DELIBERATELY tiny delta so the A/B is honest: it re-exports calm's
 * synthesis verbatim and changes exactly two things — it declares a `pad` level
 * so scripts/make-sfx.mjs renders calm's `pad()` for the full composition
 * length, and src/audio/sfxEvents.ts schedules that one asset at frame 0.
 * Nothing about the compare/swap/lock/final timbres differs, so any preference
 * you hear between the two previews is a preference about the bed.
 *
 * The pad level is specified in dBFS **RMS**, not peak, and make-sfx.mjs knows
 * that (RMS_KINDS). A 21-second sustained drone has a crest factor of only
 * ~3 dB, so peak-normalising it against the percussive bank would set its
 * loudness ~10 dB too high; RMS is the only meaningful control for a bed.
 */

import calm, {pad} from './calm.mjs';

export default {
  ...calm,
  id: 'calm-pad',
  label: 'low felt piano + warm bed',
  /** dBFS RMS for `pad`, dBFS peak for everything else — see make-sfx.mjs. */
  levels: {...calm.levels, pad: -38},
  pad,
};
