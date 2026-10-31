# Phase 3: upstream Editor reuse

Imported 2026-10-30 from the same local `3D_Magnetic_Pieces-main` 2.2.0 archive. No download or version upgrade. Archive provenance caveat, MIT Copyright (c) 2026 Saitamile and full license remain in UPSTREAM.md / LICENSE. No new dependency was required in this phase.

| Original source | Target under `src/magnetic-tiles/three-d/` | Scope retained |
|---|---|---|
| `src/editor/state.ts` | `vendor/editor/state.ts` | Snapshot clone/pushHistory/commit/commitBatch/undo/redo/canUndo/canRedo/replaceProject. Mutations adapted to the authoritative Assembly3D structure, not the upstream tutorial Project schema. |
| `src/editor/id.ts` | `vendor/editor/id.ts` | Unchanged |
| `src/editor/snap.ts` | `vendor/editor/snap.ts` | Original port/candidate/compatibility/snap routines (first portion of file); unused parent-connection and inferred-angle routines omitted. |
| `src/components/editor/EditorCanvas.tsx` | `vendor/components/editor/EditorCanvas.tsx` | Canvas and scene, TransformControls, keyboard gestures, transient drag, magnetic candidate ghost, edge/connection overlays, viewcube, camera Fit/Reset and direction buttons |
| `src/components/editor/PropertyPanel.tsx` | `vendor/components/editor/PropertyPanel.tsx` | PieceProps / ConnectionProps only: pose input/Euler conversion, axis rotation, color, duplicate/delete, connection angle presets/flip/disconnect. Tutorial/metadata UI omitted. |
| `src/test/editor.test.ts` | `checks/magnetic-3d/editor-upstream-history.vitest.ts` | Seven original ID and history test cases, updated imports and addPiece Profile/color arguments |

Original SHA-256 values are recorded in upstream-files.sha256.json. `editor.patch` records changes for the five imported implementation files against the original archive. `id.ts` produces no diff because it is unchanged. Test adaptation is documented above; geometry tests remain as previously recorded. `viewer.patch` is refreshed only to include exporting the existing ViewerErrorBoundary for Editor reuse.

Host files: `editor-project.ts`, `EditorInspector.tsx`, `draft-storage.ts` and extensions to `ThreeDWorkspace.tsx` / `viewer.css`. The derived EditorProject carries parts/transforms and a ShapeDef Map for compatibility with the imported UI. It is never serialized, stored in history or used as another Shape Registry. Full snapshots and poses live exclusively in Assembly3D.

Local changes and reasons:

1. Shape lookup uses a derived Map from the phase-one Profile Adapter, keyed by Profile ID@Version; no fixed upstream shape-name lookup. Color is #RRGGBB. Geometry/primitives/camera/lighting are the existing phase-two imports.
2. Read/display transforms are exact saved poses, without resnapshot/implicit solving. Manual transformations no longer disconnect constraints or infer dihedral angles. Edits can be geometrically invalid and remain inspectable/saveable.
3. State commits structurally validate, skip no-op edits, and increment Assembly3D.revision. Undo/Redo retain whole immutable documents, maximum 100 entries. A snapped connection plus pose placement commits once; explicit solve fixes a chosen current root and touches only its connected component. Other components remain exact.
4. Length compatibility changes from 5% to 1% to match the existing engine Validator. Snap's existing candidate selection, world-space port alignment and phase-one `computeTransformFromConnection` are retained.
5. PropertyPanel uses full-precision position input values rather than rounding untouched coordinates to two decimals. Existing Euler XYZ editing/axis shortcuts retained, quaternion remains authoritative. Connection angle/flip/endpoint changes update constraints only; a separate explicit solve moves geometry.
6. Canvas initial-fit scheduling no longer cancels on every pose edit; clean up keyboard timers and cursor, ignore modified shortcuts and form inputs, avoid duplicate object-change listener. Keep transient gesture previews outside history and block conflicting host mutations during them.
7. Shape object identity stays stable across pose edits; existing phase-two resource ownership/disposal rules retained. Remove development global injection and utility-only layout; use scoped host CSS. Export and reuse phase-two ViewerErrorBoundary; no new renderer/framework.
8. Host snapshots use the existing Studio localStorage pattern, distinct 3D key and the same Assembly3D JSON, including invalid drafts. No implicit solve on load/save/view/select. Optimistic existing-value check rejects known stale saves; it is not a transactional cross-tab lock.

Validation and manual usage are in `doc/magnetic-3d-phase3.md`. No engine core, 2D workflow, LEGO code, tutorial implementation or upstream archive was modified.

Camera metadata adaptation: optional `initialCameraView` restores an adopted Candidate's saved view and suppresses the first automatic Fit only for that opt-in case. Resize preserves its projection framing; an optional read-only camera callback supports host inspection. Default editor camera behavior, editor state/history and geometry operations are unchanged.

Assembly Snap/UI follow-up: the host reuses `computeSnapTransform`, `findBestSnapCandidate`, port compatibility/occupancy, TransformControls ghosts and upstream snapshot commits. Canvas now proposes drag snaps to the host for explicit confirmation, supports target-port overlays and a host ghost, and rolls back pointer cancellation/Escape. Click and drag share `editor-snap.ts`: only B moves; occupied ports and connected-source repositioning are rejected; new errors and collisions involving a moved source are refused. Existing unrelated Invalid diagnostics remain errors. No engine, tolerance, magnetic rule or hidden component solve changes. The toolbar is compact, provenance is collapsed in Inspector, and presets live in its Examples / Debug disclosure. `editor.patch` is refreshed against the original archive, including prior camera metadata adaptations; it uses zero-context hunks (apply with `patch -p1`, or `git apply --unidiff-zero`). See `doc/magnetic-3d-editor-snap.md`.

Assembly Inspector follow-up (2026-10-31): the host reuses the same Selection and PropertyPanel operations inside a unified Tile/Connection detail and a collapsed Edit Tools section. Duplicate identity text in PropertyPanel is supplied by the host detail instead. EditorCanvas optionally receives Assembly-only label refs; actual Mesh poses and camera projection drive a pointer-transparent DOM overlay, with occlusion against the real piece groups. Connection selection highlights both endpoint meshes and the actual A/B Port edges. `AssemblyAnnotations.tsx` is presentation only, shared with the existing Viewer; no Snap/state/engine algorithm or persisted format changed. `editor.patch` remains a zero-context reproducible patch against the same archive. Validation and UI instructions: `doc/magnetic-3d-inspector.md`.
