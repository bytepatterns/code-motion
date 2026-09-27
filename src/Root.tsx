import React from 'react';
import {Composition} from 'remotion';
import {REEL} from './theme';
import {ALGO_LIST, bubbleSort} from './algorithms';
import {buildBarTimeline} from './algorithms/spec';
import {BarSort} from './compositions/BarSort';
import {BinarySearch} from './compositions/BinarySearch';
import {BreadthFirstSearch} from './compositions/BreadthFirstSearch';
import {binarySearchReel} from './scenes/binarySearch';
import {bfsReel} from './scenes/bfs';
import {DEFAULT_STYLE, SFX_STYLES, type SfxStyle} from './audio/sfxEvents';

/**
 * Every composition in the project.
 *
 * The safe-zone layout is verified and frozen, so neither an algorithm nor a
 * sound style may fork a composition — they are the same component with
 * different defaultProps. That is also what makes the style bench at the bottom
 * a fair A/B: the only variable is the audio.
 */
const frame = {fps: REEL.fps, width: REEL.width, height: REEL.height} as const;
const sound = DEFAULT_STYLE as SfxStyle | 'silent';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* every sort in src/algorithms, through the one BarSort composition */}
      {ALGO_LIST.map((spec) => (
        <Composition
          key={spec.id}
          id={spec.compositionId}
          component={BarSort}
          {...frame}
          durationInFrames={buildBarTimeline(spec).total}
          defaultProps={{algoId: spec.id as string, sfxStyle: sound}}
        />
      ))}

      <Composition
        id={binarySearchReel.compositionId}
        component={BinarySearch}
        {...frame}
        durationInFrames={binarySearchReel.timeline(DEFAULT_STYLE).total}
        defaultProps={{sfxStyle: sound}}
      />
      <Composition
        id={bfsReel.compositionId}
        component={BreadthFirstSearch}
        {...frame}
        durationInFrames={bfsReel.timeline(DEFAULT_STYLE).total}
        defaultProps={{sfxStyle: sound}}
      />

      {/* sound-style A/B bench: the same bubble sort in every synthesised style */}
      {SFX_STYLES.map((style) => (
        <Composition
          key={style}
          id={`BubbleSortBars-${style}`}
          component={BarSort}
          {...frame}
          durationInFrames={buildBarTimeline(bubbleSort).total}
          defaultProps={{algoId: bubbleSort.id as string, sfxStyle: style as SfxStyle | 'silent'}}
        />
      ))}
    </>
  );
};
