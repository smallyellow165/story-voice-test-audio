# Magnetic Tiles — Selected Snapshot V1

## Semantics and storage

Current is the record currently being viewed and remains encoded in the existing URL. Selected is an explicit server-side reference to an immutable historical Snapshot ID. Draft remains the existing editable Review state and local draft backup. Browsing, saving and changing Current do not select a snapshot.

Each `(sourceId, stage)` has at most one active Selected reference. V1 stages are `analysis` and `review`. Analysis must be terminal (`complete` or `failed`), because a processing Analysis can still be replaced by the recognition endpoint. Selecting a terminal failed record is allowed as an explicit historical choice and does not call a model.

Metadata is stored under:

```text
generated/magnetic-intake/selected/<sourceId>/<analysis|review>/<revision>.json
```

Each tiny record contains schema version, Source ID, stage, nullable Snapshot ID, revision, timestamp and a content hash. The **highest published revision is the single active mapping**. Old metadata revisions are only concurrency records, not duplicated snapshots or a new user-facing version system. Cancelling writes a new revision with `snapshotId: null`; it does not delete or change a Snapshot.

Updates require `expectedRevision`. The server writes a complete temporary JSON file and publishes the next revision using the same exclusive hard-link primitive already used by Snapshot storage. Only one request can publish that revision, including requests from separate Node processes. A stale request receives HTTP 409 and never overwrites the winner. No lock files, database, approval system or automatic retry is introduced. Unpublished temporary files are ignored.

The API validates Snapshot existence, content hashes, Source association, terminal Analysis status and Review → Analysis lineage. Selected Review and Selected Analysis are independent references; selecting either never edits the other's ID or the Review's parent association.

Endpoints:

- `GET /api/magnetic-intake/history` includes `selectedSnapshots` alongside existing history.
- `GET /api/magnetic-intake/selected/<sourceId>` returns one state for each supported stage.
- `POST /api/magnetic-intake/selected` accepts `{sourceId, stage, snapshotId, expectedRevision}`; `snapshotId: null` cancels.

Missing snapshots/parents and corrupt metadata produce an explicit invalid Selected state. No older revision or alternate Snapshot is silently chosen. A missing Snapshot reference can be cleared with its known revision. Completely unreadable metadata blocks writes because its revision cannot be safely inferred; its explicit integrity error must be repaired at the filesystem level.

## Compact UI

The existing two left-column history controls are each a **single 40px row**: label, Current dropdown, star button and existing Info Hint. No Selected card, panel, page, extra vertical management section or persistent explanation block is added. At narrow column widths the labels shorten to “分析 / 审核”; dropdowns shrink and ellipsize within the existing resizable layout.

- `☆` selects the current saved record.
- `★` means Current is also Selected; clicking cancels Selected while preserving Current.
- Selected entries display `★ Selected` and are pinned first. Other records retain their original server time order.
- A Draft has no Review Snapshot ID, so its Review star is disabled until saved. The previously Selected Review stays marked in the dropdown.
- Review history includes all Reviews for the current Source, including those from different Analysis parents. Review option labels include `A:<parent ID>`.
- A differing Selected Review parent and Selected Analysis adds an inline `⚠` to the existing Review label. Its Info Hint gives both full IDs and states that the association is unchanged.
- Invalid references use the same inline warning and explanation. A missing selected record remains a disabled marked dropdown option, rather than disappearing or being replaced.

The Info Hint explicitly distinguishes Current, Selected and Draft and supports hover, focus and click. No new text is added to the URL.

## Restoration and asynchronous behavior

1. Explicit historical URL identities (`analysisId`, `reviewId`, `reconstructionId`, etc.) determine Current and retain existing source/lineage validation. Selected never overrides them.
2. Without explicit historical identities, an existing local draft for the Source takes priority over an automatic Selected restore. Its Analysis opens and the existing **恢复本地审核草稿** action is offered; draft contents are not silently applied over a saved Review.
3. Otherwise, Source/Analysis stage prefers Selected Analysis, then Selected Review if Analysis is unset. Review/Reconstruction stage prefers Selected Review, then Selected Analysis if Review is unset. A Selected Review always opens its actual parent Analysis, even if Selected Analysis differs.
4. If the preferred reference is invalid, the Source stays available with an explicit warning and no automatic alternate Current. Users may manually browse history or clear a readable invalid reference.
5. With no selection or draft, the existing empty historical choice remains. No “best”, newest or automatically approved record is chosen.

Opening a Source from its existing picker follows the same stage-specific defaults after the existing unsaved-edit protection path. When that path saves a draft as a new immutable Review, its corresponding stale local draft backup is removed. Saving does not update Selected.

Current is written back to the URL using the existing mechanism, so refresh/new tabs and Back/Forward preserve the concrete record. Browsing records does not re-run selection defaults. Source/record loaders guard against obsolete navigation requests. History responses merge Selected revisions monotonically so a late response cannot replace a newer confirmed selection. A stale-tab write refreshes server history and displays its conflict; Current and draft content stay intact.

## Validation

- `node --experimental-strip-types --test test/magnetic-*.test.mjs`: **63/63 passed**. Seven new tests cover per-Source/stage uniqueness, replace/cancel persistence, unchanged Snapshot bytes, browse/save independence, real two-process CAS conflicts, stale/ABA writes, wrong stages/IDs/Source/hash/lineage, processing Analysis rejection, missing targets/parents, corrupt newest metadata with no fallback, ignored temporary files, stage defaults, draft protection, stable Selected-first ordering and stale-response merging.
- `npm run build`: **passed**, including TypeScript. The existing large-bundle warning remains.
- `verify-magnetic-selected.mjs` uses the existing rose Source, multiple real historical Analyses and Reviews, and the real Snapshot/Selected APIs. It checks set/replace/cancel, single active reference, Current independence, saving a new Review without selecting it, source mismatch, dropdown order, refresh/new tabs, explicit URL/default restoration, Back/Forward, local draft protection, stale-tab HTTP 409 handling, 40px row heights, minimum left width and mobile layout.
- The browser check restores the pre-test Selected IDs in `finally`, using revision comparisons to avoid overwriting a concurrent user's later choice. Test revisions remain as concurrency metadata. All original Analysis and Review objects used by the test are checked unchanged. Test-created Reviews are new immutable records.
- **12 browser scripts passed**: the new Selected check plus existing Review UI, relative-size, shape matching, table, URL, mosaic, Catalog, Assembly, Build, partial recognition and saved Image Intake checks. The regression includes a full 17-part mosaic replay and both saved Image Intake benchmark Analyses.
- Paid Vision / LLM calls: **0**. Recognition routes are aborted in the focused browser check; Image Intake regression runs with `MAGNETIC_LIVE=0` and only replays saved Analyses.

Browser artifacts: `/tmp/magnetic-selected/{desktop.png,source-mismatch.png,narrow-column.png,mobile.png,result.json}`. Logs: `/tmp/selected-*.log`.

## Manual acceptance

Restart the project server (`npm run dev`) after installing the change so it exposes the Selected API. Open Magnetic Tiles Studio and the existing rose Source.

1. Browse an Analysis and click `☆`. It becomes `★`, and its dropdown entry is marked `★ Selected` and moves first. Browse another Analysis: the star becomes hollow, while the first record remains Selected. Click `☆` to replace it, or return to the Selected entry and click `★` to cancel.
2. Repeat for a saved Review. Try selecting an Analysis different from that Review's parent; inspect the inline `⚠` and Info Hint. Opening that Review should still use its actual parent Analysis.
3. Edit a Review. Its Current becomes Draft and its star is disabled. Save a new snapshot; confirm the old Selected entry remains selected and pinned first.
4. Copy the current full URL into another tab or refresh it. That exact Current should restore, independently of Selected.
5. Open a source-only Review URL such as `?stage=review&sourceId=<rose source ID>`. With no local draft it opens Selected Review. With a local draft, it offers the existing recovery action first. A source-only `stage=source` URL prefers Selected Analysis instead.
6. Load the same stage in two tabs, change Selected in the first, then attempt a stale change in the second. The second should show a conflict, refresh the Selected marker and preserve its Current record.
7. Resize the left column and check that both controls stay single-line. The narrow labels become “分析 / 审核”; full IDs and explanations remain available on demand.

Focused commands:

```sh
npm run test:magnetic-selected
MAGNETIC_ORIGIN=http://127.0.0.1:5173 npm run test:magnetic-selected:browser
```

## Files

- `server/magnetic-selected-snapshots.mjs` — validated references, atomic revision publication and CAS.
- `server/magnetic-intake.mjs` — reuse existing API/history dispatch.
- `src/magnetic-tiles/intake/contracts.ts` — Selected reference types / history field.
- `src/magnetic-tiles/intake/selected-snapshots.ts` — stable sorting, Source Review list, default restoration and stale-response merge.
- `src/magnetic-tiles/intake/SnapshotHistory.tsx` — shared compact Analysis/Review control.
- `src/magnetic-tiles/intake/ImageIntake.tsx` — wire explicit selection, Current restoration and existing draft protection.
- `src/magnetic-tiles/style.css` — compact history rows / narrow-label presentation.
- `test/magnetic-selected-snapshots.test.mjs` — service, process concurrency and restoration coverage.
- `scripts/verify-magnetic-selected.mjs` — real-history browser acceptance and safe selection cleanup.
- `package.json` — focused test commands.
- `doc/magnetic-selected-snapshot-v1.md` — this report.

Catalog, Profile Matching, Relative Size Scoring, Geometry Validator, Reconstruction, Assembly and Build core implementations are unchanged.

## Limits

V1 uses the project's existing local filesystem persistence and requires atomic hard links on that filesystem; no distributed database or multi-host replication is added. Small selection metadata revisions are retained rather than compacted. Entirely corrupt mapping metadata requires explicit repair, never silent fallback. Other already-open tabs refresh on history reload or a CAS conflict rather than using live push notifications. Draft recovery remains local to its browser storage and uses the existing explicit recovery action. Processing Analyses cannot be Selected until terminal. There is no new historical-record deletion API or automatic best-version selection.
