# Prompt: add a scene

Copy everything below the line into any AI coding agent that can read and edit files and run commands in this repository. Fill in the three `<…>` blocks first.

---

You are adding one new scene to **code-motion**, a Remotion project that renders 1080×1920 algorithm explainer reels entirely in code.

**The scene**

- Algorithm: <e.g. "insertion sort", "Dijkstra on a 7-node graph", "two pointers on a sorted array">
- Hook (≤ 2 lines, ~20 characters each; numbers must come from the run): <e.g. "Sorted by picking / one card at a time">
- Python to show in the code panel (≤ 42 characters per line, ≤ 6 lines): <paste or describe>

**Before writing code**

1. Read `SCENE-SPEC.md` completely. It is the contract; where this prompt and the spec disagree, the spec wins.
2. Read one example pair end to end: `src/scenes/binarySearch.ts` with `src/compositions/BinarySearch.tsx`, or `src/scenes/bfs.ts` with `src/compositions/BreadthFirstSearch.tsx`. If the algorithm is a sort, read `src/algorithms/bubbleSort.ts` instead — a sort is an `AlgoSpec`, not a new composition.
3. Read `src/theme.ts` for the tokens you are allowed to use.

**Write**

4. `src/scenes/<name>.ts` — React-free. Run the algorithm at module load, build the step clock, the `CODE`, the `HOOK`, the sound `events()` and export a `ReelSource`.
5. `src/compositions/<Name>.tsx` — draw one frame inside `<ReelFrame>`, using only `COLOR` / `TYPE` / `ZONE` / `STAGE`, inside the stage budget in the spec.
6. Register the scene in `src/timeline/registry.ts`, `src/Root.tsx` and `package.json` (`render:<name>`).

**Do not** edit `src/template/`, `src/theme.ts`, `scripts/verify-layout.mjs`, `scripts/verify-sound.mjs` or the sound banks. Do not add dependencies. Do not add recorded audio.

**Prove it** — run, in order, and fix the scene until every one passes:

```bash
npm run typecheck
npm run render:<name>
npm run check -- <CompositionId>
npm run stills -- <CompositionId>
```

Then open `docs/stills/<outFile>.png` and look at it: nothing overlapping, every label readable, the hook on two lines, the stage filled.

**Report back** with: the files you created or changed; the last lines of the `check` output for your scene (layout margins, LUFS, true peak, onsets matched); the still's path; and anything you had to trade off (for example a smaller input so it fits the stage). If a gate would only pass by loosening it, stop and say so instead.
