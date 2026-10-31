# Phase 2: upstream Viewer reuse

This document records the phase-two baseline. Later Editor state and Draft persistence extensions are documented in [EDITOR.md](EDITOR.md); its host integration supersedes the in-memory-only workspace description below.

Imported 2026-10-30 from the same local `3D_Magnetic_Pieces-main` 2.2.0 archive. No download performed. Original MIT / Copyright (c) 2026 Saitamile remains in LICENSE. Exact source checksums are in upstream-files.sha256.json; viewer.patch records the changes against the original archive.

| Upstream source | Local target under `src/magnetic-tiles/three-d/vendor/` | Retained implementation |
|---|---|---|
| `src/components/MagnetScene3D.tsx` | `components/MagnetScene3D.tsx` | Canvas, SceneContent, lighting, MagnetPieceMesh and OrbitControls composition; camera controls/reset |
| `src/components/magnet3d/primitives.tsx` | same relative path | Shape/arc paths, inset paths, frame and translucent-center extrusion, wide edge lines, decorative magnets, materials and selection highlight |
| `src/components/magnet3d/cameraUtils.ts` | same relative path | World vertices, camera-space projection bounds, orthographic zoom fit and application |
| `src/components/magnet3d/SceneLighting.tsx` | same relative path | Ambient/key/fill/top lighting and renderer configuration |
| `src/utils/geometry.ts` | `utils/geometry.ts` | Upstream polygon/inset helpers (unchanged) |

Adaptations:

1. React 19 uses `@react-three/fiber@9.8.1` and `@react-three/drei@10.7.9`; their installed peer ranges accept React 19.2.8 and Three 0.180.0. Existing runtime/development dependency versions were not upgraded. React, ReactDOM and Three deduplicate to one installed version each. Both added packages are MIT; installed transitive packages retain their own notices. No physics package was added.
2. `MagnetScene3D` keeps the upstream scene composition but replaces Model/parts/steps/getShapeDef/solveConnections with the host `ViewerPiece[]` boundary: exact ProfileSnapshot shapes, colors and saved transforms. It does not import the fixed upstream product catalog, route shell or tutorial player. Geometry validation is performed against actual poses; no rendering action solves or grounds them.
3. Host colors are explicit #RRGGBB, not upstream color-name enums. Convert through Three.Color's sRGB interpretation; retain upstream frame shading/translucent-center material patterns. No Lucide/Tailwind/router dependency is needed.
4. Preserve adapter centroid XY: replace ExtrudeGeometry.center() with Z-only centering. The old operation moved asymmetric triangles from their authoritative local origin. Keep the center slab inside the saved thickness rather than translating it above that envelope. Clamp the decorative inset to the profile inradius for narrow/small profiles.
5. Geometry caches use ShapeDef object identity instead of shape.id. Different documents with the same ID@Version but different thickness, scale or geometry cannot reuse stale GPU geometry. Per-mesh materials/line resolution are disposed on teardown; shared geometry is released only by its outgoing document. R3F automatic subtree disposal is disabled for these shared resources. A piece does not dispose geometry still shared by another piece.
6. Retain the upstream magnet-strip midpoint/cylinder placement loop, but render it through InstancedMesh with the actual instance matrices. A regular Mesh did not apply that instancing path. Decorative strips now stay inside the authoritative plate thickness instead of protruding beyond it.
7. Camera fit computes on a camera clone (no hidden live-camera mutation), supports retaining the current direction for Fit and resize, centers the projected bounds of asymmetric/disconnected pieces, and updates near/far for the fitted extent. Reset restores the default three-quarter direction. Pan is enabled; hidden camera-distance restrictions from the upstream fixed catalog are removed.
8. Disable contact shadows by default for snapshot viewing: no fake ground plane beneath arbitrary free/negative-height poses. Drawing-buffer preservation is disabled; the Viewer is not an upstream cover exporter.
9. Native scoped CSS replaces upstream utility-class layout. Catch WebGL/render startup failures within the Viewer. Remove upstream global debug-variable injection. No LEGO/DUPLO source was changed or used as a framework.

Host integration outside vendor:

- `StudioLayout` adds Assembly-stage 2D/3D viewing and view-specific portal visibility. Existing 2D controllers stay mounted. Normal workflow/URL navigation returns to 2D.
- `ThreeDWorkspace` owns only the loaded document/source/selection in memory, imports three prevalidated Assembly3D examples, and loads/reloads/exports the same format. It does not touch 2D storage or production API data.
- Assembly3D schema v1 gains an optional validated Piece3D.color (#RRGGBB). Uncolored phase-one documents still load, use a render-only default, and export without silently inserting color. No parallel project format was introduced.
- `viewer-model.ts` maps immutable snapshots to meshes and exposes read-only Inspector facts.

Regression evidence: 106 3D tests (including the 97 stage-one tests), 121 existing magnetic tests, TypeScript/build, and actual WebGL browser acceptance. Camera/frame fidelity tests exercise the adapted upstream implementation rather than replacing it with an alternative renderer. Full acceptance instructions are in `doc/magnetic-3d-phase2.md`.
