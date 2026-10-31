# Phase 4: upstream Tutorial reuse

Imported 2026-10-30 from the same local `3D_Magnetic_Pieces-main` 2.2.0 archive; no download or new dependencies. Retain the original MIT license / Copyright (c) 2026 Saitamile in LICENSE. UPSTREAM.md explains the archive/commit caveat. Original source hashes are in upstream-files.sha256.json.

| Upstream source | Target under `src/magnetic-tiles/three-d/vendor/` |
|---|---|
| `src/components/tutorial/{TutorialPlayer.tsx,useTutorialOrchestrator.ts,orchestrator.ts,easing.ts}` | Same relative paths |
| `src/components/editor/{StepTimeline.tsx,TutorialOrchestrationPanel.tsx}` | Same relative paths |
| `src/editor/state.ts` history and step/camera/animation actions | `editor/tutorial-state.ts` |
| `src/engine/types.ts` BuildStepV2 / camera / entrance / easing block | `components/tutorial/types.ts` (extracted type declarations) |
| `src/test/editor.test.ts` step-operation block | `checks/magnetic-3d/tutorial-upstream-steps.vitest.ts` |

The five imported step test cases keep their assertions except the reorder result: upstream renumbered IDs after reorder; the local fix preserves stable identity, camera and selection. Fixture creation and piece assignment use the embedded Assembly3D. Earlier engine/geometry/history tests are retained.

`tutorial.patch` records exact implementation differences for nine files. To reproduce in a scratch archive, first copy upstream `src/editor/state.ts` to `src/editor/tutorial-state.ts`; the patch is expressed against that seed path, preserving the existing phase-three state module. The other six imports use their original paths; types.ts and icons.tsx are new files in the patch. Applying it to this seeded tree reproduces all nine local files byte-for-byte. The upstream archive itself is never modified.

Retained implementation: orchestrator pure reducer/tick/entrance stages, RAF scheduling and autoNext, six easing functions, AnimatedPiece display transforms, CameraRig interpolation, cumulative/new piece logic, StepTimeline card controls and badges, TutorialOrchestrationPanel camera/animation/hint/focus/annotation/piece-assignment UI, snapshot history and step actions.

Boundary adaptations:

- Host Tutorial3D embeds an immutable authoritative Assembly3D snapshot plus source ID/revision, using original BuildStepV2 for steps. A transient TutorialProject adapts parts/shapes/transforms for the imported panel; it is not persisted or another registry.
- Player's fixed Model/shape catalog/solver path is replaced by the phase-two ViewerPiece adapter, exact saved poses, existing meshes/lighting and existing camera fit utilities. No solver runs on rendering, playback, editing steps, save or load.
- Host localStorage follows Studio's existing snapshot pattern, with a separate Tutorial key and the same tutorial import/export document. The original 2D and Assembly Draft keys are not written. Playback state stays in memory.
- Scope native CSS, use small local character icons, and replace the outer player controls/sidebar shell to fit the existing Build columns. No Lucide, Tailwind, router, physics or new player library is added.

Local correctness patches:

1. Hook dispatch/auto-next/tick read the actual destination step instead of reusing old step configuration/duration. Pause cancels pending automatic advancement. Playback reports do not reset authoring state.
2. Camera progress honors saved transitionMs (including zero); total step duration includes the camera transition. Entrance duration honors the validated stored value instead of silently clamping to 700–1000ms.
3. Highlight phase returns zero entrance offset; upstream's fading highlight progress incorrectly pulled the piece back toward its entrance origin.
4. CameraRig starts at the actual current camera, ceases writing when complete, and yields to Fit/Reset/user interaction. Report the final camera after zoom update, avoiding stale end-of-transition Inspector/capture data.
5. Disable the nested mesh's independent `isNew` drop, avoiding duplicate animation underneath AnimatedPiece; highlight new pieces with the existing selected-outline path.
6. Preserve step IDs on reorder. Assignment moves a piece from another step; delete/remove leaves the immutable source intact and produces coverage diagnostics. Derive addedConnections from when both endpoints become visible.
7. Omit misleading fold and unimplemented snapFeedback choices from the UI. Preserve optional legacy data on import; fold remains a display offset rather than hinge simulation. New camera transition input uses existing StepCamera data and callback.

No phase-one Engine, LEGO or 2D Build business code was modified. Host integration is in StudioLayout, ThreeDWorkspace's read-only committed-source bridge, ThreeDBuildWorkspace, tutorial.ts, tutorial-storage.ts and tutorial.css. Full behavior, validation evidence and manual acceptance are in `doc/magnetic-3d-phase4.md`.
