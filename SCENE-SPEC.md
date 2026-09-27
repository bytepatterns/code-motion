# Scene spec

Everything a new scene needs, in one file. It is written for people and for AI coding agents alike: follow it top to bottom, and the gates at the end tell you whether you are done.

A scene is:

| File | Role |
|---|---|
| `src/scenes/<name>.ts` | **React-free data.** Runs the algorithm, lays out the clock, the code, the hook and the sound events, exports a `ReelSource`. Imported by the Node scripts, so no React and no `remotion` import. |
| `src/compositions/<Name>.tsx` | **One frame.** Reads the scene data, resolves the step for `useCurrentFrame()`, draws inside `<ReelFrame>`. |

Read `src/scenes/binarySearch.ts` + `src/compositions/BinarySearch.tsx` (simplest) or `src/scenes/bfs.ts` + `src/compositions/BreadthFirstSearch.tsx` (a graph, a queue, ripples) before writing your own. A new **sort** does not need a composition at all — see "A new sort instead" below.

## 1. Run the algorithm — don't storyboard it

- Execute the real algorithm at module load and record what it did. Every number on screen (hook, chip, counters, the code panel's closing comment) is read from that record, never typed in. If the input changes, the video changes.
- Deterministic only: no `Math.random()`, no `Date`, no `toLocaleString()` (Chromium and Node disagree). Format numbers with `group()` from `src/scenes/format.ts`.
- Assert your invariants and `throw` at module load (`bfs.ts` checks that the graph is symmetric and connected). A wrong picture should be a crash, not a video.
- Keep inputs small enough to read on a phone: 8 bars, 12 nodes, one range bar.

## 2. Steps → a clock

- 30 fps, 1080 × 1920.
- `INTRO = 45` frames before the first step (the hook is read here).
- Give every step a `start` and a `dur`. The first 3–4 steps are slow enough to read the rule (~30 frames); after that 18–22 frames, because the tail is where the algorithm's shape shows.
- After the last step: ~22–24 frames to the closing chime (`FINAL_AT`), then at least 60 more so the chime resolves inside the clip.
- Total length 10–25 seconds. Export `TOTAL` (and whatever the composition needs: `SCENE_END`, `FINAL_AT`, the step list).

## 3. Steps → sound events

Emit a list of `RawSfxEvent` `{kind, frame, volume?}` from the same step list:

| kind | use it for | where |
|---|---|---|
| `compare` | a read where nothing moves | the step's start frame |
| `swap` | something physically moves | the frame the motion starts |
| `lock` | something is now settled (a slot, a layer, a milestone) | the settled frame (`start + dur - 1`) |
| `final` | the closing chime | `FINAL_AT`, exactly once |
| `pad` | never schedule it | the `calm-pad` style adds its bed itself |

- Leave `variant` empty unless your grammar is pitch-mapped; the scheduler rotates the bank pool deterministically and `npm run sfx` already builds every pool stem.
- One audible gesture per step. The scheduler rate-limits compares (24-frame gap and sub-perceptual level in the calm styles), drops a compare answered by the very next swap and ducks a compare that lands on an accent — do not fight it by stacking events.
- Export a `ReelSource`:

```ts
export const myReel: ReelSource = {
  compositionId: 'MyScene',          // Remotion composition id
  outFile: 'my-scene',               // out/my-scene.mp4, docs/stills/my-scene.png
  aliases: ['my-scene'],
  gain: 1,                           // per-scene loudness trim
  timeline: () => ({total: TOTAL, events: events()}),
};
```

- **Loudness is per scene.** If `verify-sound` reports integrated loudness outside the style's band, change `gain` (or a per-kind `volume` when one kind stacks up — `bfs.ts` trims its ripples with `RIPPLE_GAIN`). Never retune a bank for one scene; every other scene was measured against it.

## 4. The code panel

- Python — the panel's tokenizer highlights Python keywords and built-ins.
- **At most 42 characters per line** (840 px panel, 30 px monospace). Use short names (`arr`, `lo`, `hi`).
- 5 visible rows. A 6th line is allowed as an outro reveal: ease the panel's `scroll` from 0 to 1 over ~12 frames around the end of the scene with `interpolate`. At most two scroll moves per video; never scroll per step.
- `activeLine` (1-based) follows the phase of the current step — e.g. the compare line while the comparison is being read, the move line once the motion starts.
- The last line may be a comment carrying the measured result: `# 20 steps, n = 1,000,000`.

## 5. The hook

- **Two lines at most, about 20 characters each** at 72 px. Anything wider leaves the safe zone and fails `verify-layout`.
- A question or a claim that lands in the first second: "Can you sort this in 12 swaps?", "BFS doesn't search. It spreads."
- Numbers in the hook come from the run (§1). One coral `accent` segment per line at most.
- Eyebrow: `<Topic> · <n> seconds` with `n = Math.round(durationInFrames / fps)`.
- Badges: time and space complexity, `tone: 'primary'` for time, `'secondary'` for space.

## 6. The composition

```tsx
export const MyScene: React.FC<{sfxStyle: SfxStyle | 'silent'}> = ({sfxStyle}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  // 1. find the step whose [start, start + dur) contains `frame`
  // 2. derive every position/colour from (step, progress within step)
  return (
    <ReelFrame
      eyebrow={`Topic · ${Math.round(durationInFrames / fps)} seconds`}
      hookLines={HOOK}
      badges={[{value: 'O(n)', label: 'time', tone: 'primary'}, {value: 'O(1)', label: 'space', tone: 'secondary'}]}
      code={{lines: CODE, activeLine, scroll}}
      progress={frame / durationInFrames}
    >
      {sfxStyle !== 'silent' && <SfxTrack events={reelSfxEvents(myReel, sfxStyle)} style={sfxStyle} />}
      {/* stage content, absolutely positioned in reel coordinates */}
    </ReelFrame>
  );
};
```

Stage budget (all absolute 1080 × 1920 coordinates, all from `src/theme.ts`):

| Region | y | x |
|---|---|---|
| your drawing | ~524 – 940 | inner box `ZONE.cardX + STAGE.innerPad` = 88, width 784 |
| status chip | `STAGE.chipTop` = 960, height 56 | centred in the card |
| counters | `STAGE.counterTop` = 1026 | centred in the card |
| scrubber | `STAGE.scrubTop` = 1070 | drawn by `ReelFrame` |

Rules:

- Colours only from `COLOR`; sizes from `TYPE` (value labels ≥ 44 px). Tones: `primary` = what to look at now, `secondary` = done / locked / progress, `warning` = marked, `text3`/`text4` = idle.
- Every critical element inside `x 60..900, y 230..1400`. Decorative texture only may leave it, and only at luma ≤ 70.
- Animate from `frame` alone with `spring()` / `interpolate()` — no CSS transitions, no React state, no effects.
- A label that can cross a filled shape gets a canvas plate (`background: ${COLOR.canvas}E6`), as in `BarSort`.
- Reuse the chip and counter markup from an example so every scene reads the same.

## 7. Register

1. `src/timeline/registry.ts` — import your `ReelSource` and append it to `REEL_SOURCES`.
2. `src/Root.tsx` — add a `<Composition id={myReel.compositionId} component={MyScene} {...frame} durationInFrames={myReel.timeline(DEFAULT_STYLE).total} defaultProps={{sfxStyle: sound}} />`.
3. `package.json` — add `"render:my-scene": "remotion render MyScene out/my-scene.mp4"`.

**A new sort instead?** Write an `AlgoSpec` module next to `src/algorithms/bubbleSort.ts` (steps from the six step types, the Python, counters, badges, hook), add it to `ALGO_LIST` / `ALGORITHMS` in `src/algorithms/index.ts` and extend `AlgoId` in `src/algorithms/spec.ts`. `BarSort` renders it and `Root.tsx` / the registry pick it up automatically.

## 8. Gates — the definition of done

```bash
npm run typecheck
npm run render:my-scene
npm run check -- MyScene     # verify-layout + verify-sound
npm run stills -- MyScene    # docs/stills/my-scene.png — then LOOK at it
```

- **verify-layout:** zero frames with content (luma > 70, a run of 3 px) outside `x 60..900, y 230..1400`.
- **verify-sound:** audio stream present, duration equals the timeline, integrated loudness inside the style's band, true peak under its ceiling, a/v sync within ±3 frames of the premix, every audible event has an onset within ±2 frames, no clipped samples, the middle of the track carries level.
- **still review:** open the PNG. Nothing overlaps, every label is readable, the hook fits on two lines, the stage is not empty.

If a gate fails, fix the scene. Never loosen a gate, never edit `src/template/` or the safe-zone tokens to make a scene fit.

## 9. Checklist

- [ ] The algorithm is executed at module load; every on-screen number is read from the run.
- [ ] No randomness, no dates, no locale formatting.
- [ ] 10–25 s, `INTRO` 45 frames, ≥ 60 frames after the final chime.
- [ ] Events: compare / swap / lock / final, one gesture per step.
- [ ] Code ≤ 42 chars per line, ≤ 6 lines, `activeLine` follows the step.
- [ ] Hook ≤ 2 lines, ~20 chars each, measured numbers.
- [ ] Only `COLOR` / `TYPE` / `ZONE` / `STAGE` tokens; nothing critical outside the safe zone.
- [ ] Registered in `registry.ts`, `Root.tsx` and `package.json`.
- [ ] `typecheck`, `check` and a looked-at still.
