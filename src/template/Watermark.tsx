import React from 'react';
import {COLOR, TYPE, WATERMARK, ZONE} from '../theme';
import {FONT_MONO, FONT_SANS} from '../fonts';

/**
 * Glyph + wordmark, both from WATERMARK in theme.ts, at low opacity.
 *
 * SAFE ZONE: pinned bottom-LEFT (x from 60) — the bottom-right corner is
 * covered by the like/comment/share icon rail on all three platforms.
 */
export const Watermark: React.FC<{opacity?: number}> = ({opacity = WATERMARK.opacity}) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: ZONE.markTop,
        left: ZONE.pad,
        height: ZONE.markH,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        opacity,
      }}
    >
      {WATERMARK.mark ? (
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: TYPE.mark,
            fontWeight: 600,
            lineHeight: `${ZONE.markH}px`,
            color: COLOR.primary,
          }}
        >
          {WATERMARK.mark}
        </span>
      ) : null}
      <span
        style={{
          fontFamily: FONT_SANS,
          fontSize: TYPE.mark,
          fontWeight: 800,
          letterSpacing: 0.4,
          lineHeight: `${ZONE.markH}px`,
          color: COLOR.text1,
        }}
      >
        {WATERMARK.text}
      </span>
    </div>
  );
};
