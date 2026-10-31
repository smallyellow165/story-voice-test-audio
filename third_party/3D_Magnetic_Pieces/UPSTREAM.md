# Upstream provenance

- Project: https://github.com/fengyanhao/3D_Magnetic_Pieces
- Source used: `/home/umi/min-wrk/projects/story-voice-lab/work/3D_Magnetic_Pieces-main` (local archive; no `.git`, no download performed).
- Package identity: `3d-magnetic-blocks-tutorial@2.2.0`.
- Imported: 2026-10-30.
- Prior investigation reference commit: `7b56ae624a7892b5c78bf642eec77fc729b6625e`. The local archive's version, original `solver.ts` and `types.ts` match that investigation; the archive itself cannot certify its Git commit.
- License: MIT, Copyright (c) 2026 Saitamile. Complete original text in [LICENSE](LICENSE); retain with copies/substantial portions.
- Exact original imported file SHA-256 values: [upstream-files.sha256.json](upstream-files.sha256.json).

Source mapping:

| Upstream | Local |
|---|---|
| `src/engine/{types,shapes,solver,validator}.ts` | `src/magnetic-tiles/three-d/vendor/engine/` |
| `src/test/engine.solver.test.ts` | `checks/magnetic-3d/upstream/engine.solver.vitest.ts` |
| `src/test/engine.validator.test.ts` | `checks/magnetic-3d/upstream/engine.validator.vitest.ts` |
| `src/test/shapes.test.ts` | `checks/magnetic-3d/upstream/shapes.vitest.ts` |

All 50 imported test assertions are retained. Test filenames, import targets, explicit `.ts` suffixes and erased type imports changed. One upstream flat-adjacency fixture also needs `flip:true`: the original placed its squares on top of one another and passed only because the old seam exception hid that collision. The expected-valid assertion is unchanged; the fixture now represents actual adjacency. The separate `checks/` directory and `.vitest.ts` suffix keep Vitest cases out of the existing `node --test` discovery, without changing that command.

[PATCHES.md](PATCHES.md) explains local engine changes. [engine.patch](engine.patch) records their unified diff against the local archive (including the new outline helper), with paths relative to the upstream project. Keep this record alongside future updates. No upstream Viewer, Editor, Tutorial, data catalog, scheme persistence, router or deployment files were imported.

The only new dependency is dev-only `vitest@5.0.5` (MIT). It runs the same assertion API with the existing Vite 8 / Node 24 environment. Existing Three.js 0.180.0 (MIT) and other runtime dependency versions are retained. No physics engine or React Three Fiber dependency was added. Installed packages retain their own license files; distribution of dependencies must retain applicable notices as usual.
