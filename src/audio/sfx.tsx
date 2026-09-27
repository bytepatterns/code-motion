import React from 'react';
import {Audio, Sequence, staticFile} from 'remotion';
import {SFX_FRAMES} from './sfxManifest';
import {sfxSrc, type SfxEvent, type SfxStyle} from './sfxEvents';

/**
 * Renders the scheduled SFX as Remotion sequences. No music — by design.
 *
 * The asset for an event is picked by `style` + `variant`, so the same event
 * list drives every sound style and the visual composition never has to
 * know which one is playing.
 */
export const SfxTrack: React.FC<{events: SfxEvent[]; style: SfxStyle}> = ({events, style}) => {
  const frames = SFX_FRAMES[style];
  return (
    <>
      {events.map((e, i) => (
        <Sequence
          key={`${e.variant}-${e.frame}-${i}`}
          from={e.frame}
          // the manifest length covers the decay + reverb tail of that exact
          // asset, so a sequence never truncates a note mid-ring
          durationInFrames={frames[e.variant] ?? 12}
          layout="none"
        >
          <Audio src={staticFile(sfxSrc(style, e.variant))} volume={e.volume} />
        </Sequence>
      ))}
    </>
  );
};

export {buildSfxEvents, SFX_STYLES, DEFAULT_STYLE} from './sfxEvents';
export type {SfxEvent, SfxKind, SfxStyle} from './sfxEvents';
