# Magnetic Tiles — Estimated Profiles + Relative Size Matching V1

Implemented using the existing Catalog → Review → Geometry / Assembly / Build references. No Vision rerun, new model, paid call, manufacturer database, perspective correction, or geometry-tolerance change.

## Catalog

The three existing JSON objects are unchanged, including their version, vertices, names, and edge definitions. Two entries are appended to `src/magnetic-tiles/profiles.json`:

| ID / version | Vertices | Edge lengths |
| --- | --- | --- |
| `large-equilateral-triangle@1` | `(0,0), (2,0), (1,√3)` | `2, 2, 2` |
| `tall-right-triangle@1` | `(0,0), (1,0), (0,2)` | `1, √5, 2` |

All edges are connectable subject to the unchanged equal-length, full-edge Geometry Validator rules. The unit is the standard square side. The first is approximately a 15 cm equilateral triangle; the second has approximately 7.5 × 15 cm legs. Each stores `sizeEvidence.status: estimated` and the project-supplied **V1 Estimated Geometry** source. Neither claims exact official CONNETIX measurements. Catalog cards, Inspector, candidate metadata, and the derived server recognition facts use the same records.

## Matching and calibration

`profile-match.ts` remains unchanged. It computes the original translation, rotation, reflection, and uniform-scale invariant Shape Score. `relative-size.ts` adds independent deterministic calibration and size scoring.

1. Convert normalized outlines using the Source's actual width and height. Measure RMS vertex distance from the centroid, denoted `radius`. This is rotation/reflection invariant and scales linearly with image size.
2. Exclude the matching target, Unknown, Excluded, invalid contours, unknown ID/version pairs, and assigned profiles with Shape Score < 80. Automatic references require Observation confidence ≥ 0.90; explicit outline confirmation can replace that confidence prerequisite. Very small calibration scales (< 8 px/unit) are ignored.
3. A profile with a scale-equivalent catalog alternative cannot automatically be a reference; explicit outline confirmation is required. Standard `square@1` references take priority over other eligible families. Otherwise use eligible known profiles. A Known label is a prerequisite, never inferred from shape ranking alone.
4. Each reference contributes `pixel radius / profile radius`. Find the median in log space, retain samples within a multiplicative factor 1.25, and require a strict majority of the selected reference pool. Average the retained log scales (geometric mean). Show retained IDs, individual measurements, source uncertainty, and rejected outliers. Single references are explicitly labeled as lacking cross-validation.
5. If there is no reliable reference or no strict majority, return **Size Unknown**, with `null` numeric score and size ratio. Rank only by the original Shape Score; same-shape sizes remain tied.
6. For each compatible-vertex candidate, compute `R = observation radius / (pixels-per-unit × profile radius)`. Let `T = min(ln(1.40), max(ln(1.25), 2 × reference log-scale RMS spread))`. **Relative Size Score = `100 × 2^(−(ln(R)/T)²)`**. A factor 1.25 size error normally gives 50; small errors degrade smoothly. Reciprocal errors receive equal scores. This is an explanatory geometry score, not a probability or confidence interval.
7. Recommendation order uses `Shape Score × Relative Size Score / 100`. Both components remain visible; Size Score never overwrites Shape Score. All catalog entries participate. No score threshold blocks manual selection; the existing complete-outline evidence prerequisite and vertex-count prerequisite remain. The existing dropdown remains available for explicit corrections.

Textual uncertainty is preserved and displayed, not interpreted using semantic rules. In particular, Known high-confidence squares with quantitatively reliable contours can calibrate despite minor rim-localization notes. A confidently incorrect Known assignment can still bias the scale; inspect reference evidence before accepting a recommendation. Changing a reference to Unknown or excluding it removes it from calibration. Matching never modifies reference labels or automatically applies a candidate.

Profile assignments continue to save through the existing immutable Review API. Scales and scores are recomputed from the current draft and Catalog; temporary outline confirmation is UI-only, as before. Reloading a saved Review restores the assigned ID/version but requires renewed outline confirmation before scoring uncertain contours.

## Existing rose evidence

Source: `connetix-rose.png`, **792 × 977**. Source ID `5fc64c5cfbbd7e39e1abe7198ee373cf3f60f268698a7e7b87302a5c494e6e7f`.

Original Analysis: `ec08916f-a0d5-4be7-964e-f63a52df22b9`.

The committed deterministic fixture captures existing Review `622be109-1345-4abb-abf2-a97538e27cca`, including the manually assigned P4/P5/P6 profiles and all original outlines/uncertainty. It contains no new Vision output.

Standard green squares S1–S4 contribute **112.9798, 112.9798, 113.0287, 113.0287 px/unit**, giving **113.0042259 px/unit**. Their Shape Scores are ≥ 99.999, their Observation confidence is 0.99, and their minor drawing uncertainty remains visible. No rose-specific matching condition is used.

| Observation / candidate | Shape Score | Relative Size Score | Radius ratio observed / expected | Recommendation |
| --- | ---: | ---: | ---: | --- |
| P1 / Tall Right Angle Triangle | 87.8323 | 92.2950 | 0.926915 | #1 |
| P2 / Large Equilateral Triangle | 99.9958 | 99.9996 | 1.000545 | #1 |
| P2 / Standard Equilateral Triangle | 99.9958 | 0.1233 | 2.001089 | #2 |
| P3 / Tall Right Angle Triangle | 86.3233 | 92.6485 | 0.928614 | #1 |

P1 has measured legs approximately **1.018 / 1.805 units**, P3 approximately **1.026 / 1.805 units**, versus the estimated profile's **1 / 2**. Their long legs are about 9.7% shorter and their overall RMS radii about 7.3% / 7.1% smaller than expected. The drawing's outlines/proportions are approximate; the shape and size errors are deliberately retained rather than adjusted to obtain a perfect score.

P2's lower corners are estimated behind neighboring tiles according to the original Analysis. The excellent scores describe those supplied coordinates; they do not establish that the hidden boundary is correct. Existing uncertain-outline confirmation remains required, and keeping Unknown is valid when the boundary cannot be verified. This validation does not certify the entire rose as a legal reconstruction.

Browser acceptance saved a **new** Review `25478605-8828-4b36-b401-a51fd67fa9c2` with P1/P3 tall and P2 large. P4/P5/P6 and every contour were checked against the prior Review for exact equality. Original Analysis and historical Review were checked unchanged. Additional test snapshots demonstrate low-score manual assignment; none overwrites history.

## Historical compatibility

Build already hashes only the profiles used in its snapshot, so existing Build bundles continue to validate without changes to Build Engine. Existing Assembly stores ID/version references and remains compatible.

Reconstruction previously hashed the entire Catalog. `server/magnetic-intake.mjs` now accepts a historical fingerprint only if it equals an unchanged prefix of the current append-only Catalog and that prefix covers every referenced profile. Altered old definitions or references outside the matching prefix are still rejected. Historical files and hashes are not rewritten. Reconstruction search and Geometry Validator implementations are unchanged.

## Validation

- `node --experimental-strip-types --test test/magnetic-*.test.mjs`: **52/52 passed**. Includes new estimated geometry, same-shape sizes, Unknown, self-reference exclusion, ambiguous references, confidence/exclusion/invalid contours, noisy/outlier/conflicting references, square priority, image-resize invariance, smooth symmetric tolerances, independent shape scores, low-score assignment, captured rose, old Build fingerprints, historical Reconstruction fingerprints, and new-profile Reconstruction/Assembly/Build checks.
- `npm run build`: **passed**, including TypeScript. Existing large-chunk build warning remains.
- Browser checks use the production `dist` UI with the real local API. Passed: `verify-magnetic-relative-size.mjs`, `verify-magnetic-catalog.mjs`, `verify-magnetic-profile-match.mjs`, `verify-magnetic-review.mjs`, `verify-magnetic-url.mjs`, `verify-magnetic-tiles.mjs`, and `verify-magnetic-build.mjs`. They cover new catalog SVGs/source metadata, rose rankings, manual low-score application/save/reload, Size Unknown, preserved reviewed parts, copied URLs/new tab/refresh, historic candidate → Assembly → Build, existing geometry editing, table filters/resize/scrolling, and narrow layouts.
- `verify-magnetic-mosaic.mjs` with `MAGNETIC_VISUAL_ACCEPTED=1`: **passed**, including all 17 parts, three components, 17 connections, exact source references, complete tutorial replay/export/import, and preserved historical evidence.
- Paid model calls: **0**. Relevant browser routes explicitly abort recognition requests. Existing paid credentials are not needed for this work.

Browser evidence: `/tmp/magnetic-relative-size/` (`p1.png`, `p2.png`, `p3.png`, `size-unknown.png`, `catalog.png`, `narrow.png`, `result.json`). Test logs: `/tmp/magnetic-tests.log`, `/tmp/magnetic-build.log`, and `/tmp/magnetic-*-browser.log`.

The optional Browser connection had no available session; the project-installed Playwright route was used. Acceptance used the production build to isolate it from development-server hot-reload ports; history-sensitive checks ran sequentially.

## Manual test

Restart the project's development server once after these changes (`npm run dev`) so its server-side Catalog is refreshed. Open `/story-voice-test-audio/magnetic-tiles.html`.

1. In Supported Tiles, select the new profiles and inspect the vertices, edge lengths and Estimated source.
2. Open the existing rose Source, Analysis and a Review where P4/P5/P6 were manually confirmed; use Review `622be109-1345-4abb-abf2-a97538e27cca` for the captured starting point. Do not press the paid recognition button.
3. Select P1/P2/P3 and click Find Matching Profile. Inspect the uncertainty and confirm the complete outline only when justified. Inspect Shape Score, Relative Size Score, reference IDs and observed/expected dimensions. Use “查看全部候选” to inspect every profile.
4. Try applying Standard Equilateral Triangle to P2 despite its low size score. Save a new Review and reload/copy its URL to verify the choice persists. Restore the desired profile in another new snapshot.
5. To test Size Unknown, temporarily exclude all other known tiles (or change their profiles to Unknown) and rerun matching. Restore the saved Review afterward.
6. Open the saved result Review `25478605-8828-4b36-b401-a51fd67fa9c2` through the history selector or a URL using its Review ID. P4/P5/P6 remain as previously confirmed. Recommendations do not auto-change them.

Convenient commands: `npm run test:magnetic-relative-size`, and `MAGNETIC_ORIGIN=http://127.0.0.1:5173 npm run test:magnetic-relative-size:browser` (requires the existing rose records and server). The browser script creates new immutable test Review snapshots.

## Changed files

- `src/magnetic-tiles/profiles.json` — append two versioned estimated profiles.
- `src/magnetic-tiles/geometry.ts` — optional metadata type only; validation logic unchanged.
- `src/magnetic-tiles/SupportedTiles.tsx` — Estimated/source presentation.
- `src/magnetic-tiles/intake/relative-size.ts` — deterministic calibration, independent size scoring, candidate ordering.
- `src/magnetic-tiles/intake/ProfileMatcher.tsx` — reuse existing matching UI for both scores and explanations.
- `src/magnetic-tiles/intake/ImageIntake.tsx` — supply current-draft calibration to the matcher.
- `server/magnetic-intake.mjs` — strict append-only Catalog hash compatibility.
- `test/magnetic-relative-size.test.mjs` — new behavior and captured rose coverage.
- `test/fixtures/magnetic-intake/rose-relative-size.json` — captured existing Review geometry/evidence.
- `test/magnetic-profile-match.test.mjs` — preserve shape-only expectations with scale-equivalent candidates and the new tall shape.
- `test/magnetic-tiles.test.mjs` — expect five registered profiles; existing exhaustive geometry checks include all five.
- `test/magnetic-build.test.mjs` — use an equal-length anchor when testing profiles without a unit edge.
- `test/magnetic-intake.test.mjs` — historical hash compatibility and rejection coverage.
- `scripts/verify-magnetic-relative-size.mjs` — real-history production UI acceptance.
- `scripts/verify-magnetic-profile-match.mjs` — check every displayed candidate's evidence gate without assuming a fixed shortlist.
- `package.json` — focused unit/browser test commands.
- `doc/magnetic-relative-size-v1.md` — this report.

## Limits

Same-plane, approximately uniform-scale imagery is assumed. Strong perspective, different depth planes, partial contours, wrong Known identities or several consistently wrong references can bias calibration; no perspective correction or semantic interpretation of uncertainty is attempted. A single reference cannot cross-check itself. High scores are geometry agreement, not proof of real physical dimensions. Runtime outline-confirmation flags are not permanent Profile-verification records. Catalog history compatibility requires append-only ordering and unchanged old entries. Standard and large equal-sided triangles cannot be distinguished without a trustworthy size reference. Existing reconstruction constraints, strict full-edge connectivity, and image-evidence uncertainty remain in force.
