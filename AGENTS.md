# Notes for AI coding agents

- Adding or changing a scene: follow [SCENE-SPEC.md](SCENE-SPEC.md). A ready-made brief is in [prompts/new-scene.md](prompts/new-scene.md).
- Definition of done: `npm run typecheck`, the scene's `render:*` script, `npm run check -- <CompositionId>` and a looked-at `npm run stills -- <CompositionId>` image.
- Scene modules in `src/scenes/` and everything reachable from `src/timeline/registry.ts` are imported by Node scripts: no React, no `remotion` imports there.
- Do not edit `src/template/`, the safe-zone tokens in `src/theme.ts`, or the two verify scripts to make a scene pass. Fix the scene.
- Sound is synthesised only (`npm run sfx`). Do not add recorded audio or background music.
