# Image-centered History V1 — Penguin recovery

This step adds an image filter to the existing Parts Explorer History, not a second history store or selected-run system. Both assembled and loose-parts panels use their existing canonical History responses. Grouping and filtering use only `sourceImageId`; file names, timestamps, model payload hashes and status do not establish identity. The assembled list exposes each run ID and status explicitly. Filtering never loads a run or calls a model. Selecting an image reads its existing canonical original for a preview; selecting an Analysis and pressing Load uses the unchanged restore path.

## Actual scoped repair

Four existing successful Penguin Analysis records were explicitly repaired:

- `abf0baf5-f2f6-472b-af31-0c3c51231ef1`
- `80a0ad1a-db21-4f5d-ba3b-96215e1aed83`
- `1b9a8805-4228-43fb-9437-265cfb316606`
- `ed37d020-0a2c-4dd4-bb29-8c3aa93cbb68`

All have the exact same 219353-byte original:
`sha256:957bfeec320e103ebccb1b05aafe44c49088a908961868b6af47f31d22965b09`.
Their compressed input digest remains `9c93db41cb895e17af842d1dfa586862231beb1a3d883b2cadc24303d6e9304f`.

The repair only adds `sourceImageId` to these four records and creates one canonical image under `generated/brick-source-images/`. All preexisting JSON fields remain semantically identical, including old fingerprints. The four whole-file hashes necessarily change; no discovered canonical brick record consumes those whole-file hashes. Three guided parent references hash the unchanged `analysis` contents, and still match. Original byte-for-byte backups preserve the original serialization.

Audit location: `output/source-image-repair-penguin-v1/`:

- `plan.json`: explicit IDs, before/after digests, image evidence, protected file snapshot.
- `<analysisId>.before.json`: four exact original backups.
- `result.json`: applied IDs, after snapshot, 257 protected original files verified unchanged.
- `lineage-verification.json`: Review and Build Plan checks, guided parent checks.
- `http-verification.json`: checks through the current server on temporary port 5174.

There were 261 existing files in the canonical `generated/brick-*` scope before repair. Review, Search, Spatial, Geometry, Selection, Build Plan and raw trace files were not rewritten. The main Review still has 12 confirmed instances and its `reviewVersion` matches Spatial `f18759ed-d4e1-45cc-b257-4ad5d71d48a8`. Build Plan `426f27c7-a9a9-4ee9-9965-39e1cd9e30f8` still validates complete and points through Selection `77d99b0e-9c62-4ba6-b655-bcf1a8db5828` to the same Analysis.

Old retry fingerprints are retained as historical evidence. Do not re-submit an old request ID as a new analysis; use the existing restore endpoint, or explicitly start a new run with a new request ID.

## Deferred records

Eight reverse Analysis records remain unlinked and are reported by the strict History reader. Nothing was deleted. These include five Camel runs, Rooster, and the failed/revised Penguin branch outside the recovered four-run ancestry.

Main Camel `0474c775-ae2f-40d7-87d2-dd0e2b4ee3fa` has recoverable original bytes, but its whole-file hash is consumed by Spatial traces `f1f84e96…`, `566bb2e1…`, `ef8bf2f6…`, `a1a2ae30…`. It was deliberately left unchanged. Safest next manual route is a new Analysis of the verified original through the normal workflow; it will be a new run, not recovered old history. Recovering the old Camel branch needs a separately reviewed dependency-aware repair, not rehashing those traces silently. No legacy readers or relaxed validators were added.

## Offline operation

`scripts/repair-source-image-links.mjs` is not imported by runtime. It requires explicit UUIDs. `plan` is read-only; `apply` requires that exact plan and a new audit directory. Before writing, it rechecks the complete snapshot, refuses whole-record hash consumers, verifies original/wire evidence and guided parent hashes, and backs up all target files. Conflicts stop the operation; partial failures are reported in `failure.json`, never silently retried. An operator must inspect the audit before any rollback; do not restore old backups over newer user edits.

Do not rerun the completed Penguin operation. Future repairs require a new explicit scope and plan.

## Manual acceptance

Restart the existing dev server so frontend and API both use current code. The previously running 5173 process was serving an old History schema during verification.

1. Open `/story-voice-test-audio/brick-inventory.html`, switch to assembled Parts Explorer and locate the existing History controls.
2. In “按 Source Image 查看”, choose the image ID above (four Analysis runs). Check the original Penguin preview.
3. Choose `80a0ad1a…`, press “加载识别结果”, and inspect its independent Analysis/Review. Then choose `ed37d020…` and load it. Loading/filtering must not invoke recognition or save Review.
4. For `ed37d020…`, confirm 11 recognized observations plus the manually saved hidden wing, totaling 12 effective instances. The Source Image link must match for all four runs. “全部图片” returns to the original unfiltered History.
5. Follow the existing Design Lab / Spatial link. Explicitly open Spatial Plan `f18759ed…`, Geometry `c34c5c9a…`, candidate-1 and saved Selection `77d99b0e…`.
6. Open saved Build Plan `426f27c7…` in the existing Player and inspect its 11 steps. It remains a draft; this change does not promote it or certify physical assembly.
7. Verify unresolved History warnings remain explicit. No latest-success or filename association is performed by the new filter.

Automated checks cover repair refusal, protected-file preservation, canonical grouping, no guessed links, SSR filter markup, Source Image and existing restore/review behavior. Browser automation was unavailable (no connected browser); visual clicking and real assembly remain manual acceptance steps. No paid model calls were made.

## Selected Analysis V1

Selection is an explicit mutable relationship owned by Source Image. It is stored at
`generated/brick-source-images/selected-analysis/<original-sha256-hex>.json`:

```json
{
  "schemaVersion": 1,
  "imageId": "sha256:<original image digest>",
  "selectedAnalysisId": "<analysis UUID>",
  "analysisKind": "reverse",
  "revision": 1
}
```

`analysisKind` is `reverse` or `inventory`, addressing the existing canonical store explicitly. Both kinds share the same per-image choice file. No Analysis, Review, image bytes, model output, or downstream data is copied here. The immutable Source Image JSON remains unchanged. There is no automatic initial choice: an absent relationship is defined as no selection (GET returns null IDs and revision 0). An existing corrupt relationship or target fails closed; it is never treated as absent.

GET `/api/brick-source-images/:imageId/selected-analysis` reads and validates the relationship. POST takes `{analysisId, analysisKind, expectedRevision}` and requires same-origin access. The server checks canonical image identity, original bytes, exact Analysis ID, image ownership, successful status, record kind and the existing output validator. The target's original canonical record is read; loaded UI edits are not selected or saved. Selection does not select or version its Review.

An exclusive per-image filesystem lock, expected revision check, and atomic rename enforce one current value across concurrent requests and service instances. A stale page gets 409 and must refresh and make a new explicit choice; there is no automatic retry. A crash may leave a `.lock` file: after confirming no writer is active, an operator must inspect the relationship and remove that stale lock explicitly. Runtime does not guess lock age or silently recover it. This V1 retains all execution History, but does not introduce a history of choice changes.

Both assembled and loose Parts Explorer show this control beside existing History. Filtering and Load only read state. Select acts on the currently loaded Analysis, never the dropdown's not-yet-loaded entry. A mismatched image, unsuccessful run, pending read or busy panel disables Select. The selected ID is always displayed for the current image; when loaded it is additionally marked **Selected**. “刷新选择状态” reads changes made in another tab. Existing downstream runs keep their original explicit references; this relationship does not redirect them.

### Selected Analysis acceptance

Restart the dev server, open `/story-voice-test-audio/brick-inventory.html`, then assembled Parts Explorer:

1. Filter the Penguin Source Image above; its four Analysis records remain present. Initially the selection is empty unless a user has already made one.
2. Load `80a0ad1a-db21-4f5d-ba3b-96215e1aed83`, inspect it, then click **Select · 采用已加载的 Analysis**. Confirm its ID and Selected state.
3. Choose another dropdown row without loading: this must not change Selected or the Select target. Load `ed37d020-0a2c-4dd4-bb29-8c3aa93cbb68`; the previous selected ID must remain until explicitly clicking Select.
4. Select the loaded `ed37d020…`, refresh the page, filter Penguin again, and confirm that selected ID restores. Load it and confirm the Selected badge. Restart the service and repeat if desired.
5. Check all four histories remain loadable. Open the existing saved Review and Design Lab chain using the previous acceptance instructions; no source reference changes.
6. Optionally load the same current selection revision in two tabs. Change it in one; a subsequent stale selection in the other must fail with a refresh message, rather than overwrite it automatically.

Validation for this change: 50 scoped tests passed (7 new selection tests), production build passed, HTTP checks confirmed initial empty choice, invalid revision rejection (422), cross-origin rejection (403), and unchanged original-image GET. Penguin's four real records were selected only inside temporary test copies. All 262 real `generated/brick-*` files retained their SHA-256 hashes; no real selection, migration, deletion, Review edit or paid LLM call was performed. Browser connection was unavailable; actual interactive acceptance remains manual.
