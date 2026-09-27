import React from 'react';
import {COLOR, TYPE, ZONE} from '../theme';
import {FONT_MONO} from '../fonts';

const KEYWORDS = new Set([
  'for',
  'in',
  'if',
  'not',
  'and',
  'or',
  'else',
  'elif',
  'while',
  'return',
  'def',
  'break',
  'True',
  'False',
  'None',
]);

const BUILTINS = new Set(['range', 'len', 'print']);

type Tok = {text: string; color: string};

/** Minimal Python tokenizer — theme palette only. */
const tokenize = (line: string): Tok[] => {
  const out: Tok[] = [];
  const re = /(#.*$)|([A-Za-z_][A-Za-z0-9_]*)|(\d+)|(\s+)|([^\sA-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const [text, comment, word, num, space, punct] = m;
    if (comment) out.push({text, color: COLOR.text4});
    else if (word)
      out.push({
        text,
        color: KEYWORDS.has(word)
          ? COLOR.secondary
          : BUILTINS.has(word)
            ? COLOR.text2
            : COLOR.text1,
      });
    else if (num) out.push({text, color: COLOR.primary});
    else if (space) out.push({text, color: COLOR.text3});
    else if (punct) out.push({text, color: COLOR.text3});
  }
  return out;
};

export type CodePanelProps = {
  lines: string[];
  /** 1-based index of the line to highlight coral. */
  activeLine: number;
  /**
   * Viewport scroll in lines (float, so the composition can ease it). The panel
   * only shows VISIBLE_LINES rows; the source is 6 lines, so the outro scrolls
   * by exactly one line to reveal the early-exit return.
   */
  scroll?: number;
};

/** Safe-zone budget: ZONE.codeH (238) - 2*PADDING (36) = 200 = 5 * LINE_H. */
export const VISIBLE_LINES = 5;
const LINE_H = 40;
const GUTTER = 42;
const PADDING = 18;

export const CodePanel: React.FC<CodePanelProps> = ({lines, activeLine, scroll = 0}) => {
  const maxScroll = Math.max(0, lines.length - VISIBLE_LINES);
  const offset = Math.min(maxScroll, Math.max(0, scroll));

  return (
    <div
      style={{
        position: 'absolute',
        left: ZONE.cardX,
        top: ZONE.codeTop,
        width: ZONE.cardW,
        height: ZONE.codeH,
        background: COLOR.surface,
        border: `2px solid ${COLOR.border}`,
        borderRadius: 24,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* viewport: exactly VISIBLE_LINES rows tall, so a hidden row is fully
          hidden rather than sliced in half at the panel edge */}
      <div
        style={{
          position: 'absolute',
          left: PADDING,
          top: PADDING,
          width: ZONE.cardW - 2 * PADDING - 4,
          height: VISIBLE_LINES * LINE_H,
          overflow: 'hidden',
        }}
      >
      <div
        style={{
          transform: `translateY(${-offset * LINE_H}px)`,
        }}
      >
        {lines.map((line, idx) => {
          const isActive = idx + 1 === activeLine;
          return (
            <div
              key={idx}
              style={{
                position: 'relative',
                height: LINE_H,
                display: 'flex',
                alignItems: 'center',
                borderRadius: 9,
                background: isActive ? `${COLOR.primary}24` : 'transparent',
                boxShadow: isActive ? `inset 4px 0 0 0 ${COLOR.primary}` : 'none',
              }}
            >
              <div
                style={{
                  width: GUTTER,
                  flexShrink: 0,
                  textAlign: 'center',
                  fontFamily: FONT_MONO,
                  fontSize: TYPE.codeGutter,
                  fontWeight: 600,
                  color: isActive ? COLOR.primary : COLOR.text4,
                }}
              >
                {isActive ? '▸' : idx + 1}
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: TYPE.code,
                  fontWeight: 500,
                  lineHeight: 1,
                  whiteSpace: 'pre',
                }}
              >
                {tokenize(line).map((t, i) => (
                  <span key={i} style={{color: t.color}}>
                    {t.text}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
};
