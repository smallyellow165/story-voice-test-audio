# Image-centered Workflow History V2

This is a read-only projection of the existing canonical stores, not a saved
index, new workflow engine, or downstream selection system. No real records were
migrated, selected, edited or deleted. Generation and validation code is unchanged.

## Evidence contract

| Stage | Canonical evidence and identity | Relationship handling |
| --- | --- | --- |
| Source Image | `brick-source-images/<hex>.json`, `imageId` | Existing reader verifies original-byte SHA-256. |
| Analysis | `brick-reverse/<id>.json`, `id`, `sourceImageId`, `originalImage` | Existing History/read validation verifies the image reference. No grouping by names or times. |
| Current Parts Explorer Review | `<analysisId>.json.review`, `analysisId`, `updatedAt`, rows/search references, hidden parts, manual relations | Mutable current document, not an immutable review run. Existing restore and `reviewedSource` derive the current semantic version; a before/after read guards concurrent edits. |
| Historical Review input | Spatial `requestInput.provenance.{analysisId,reviewVersion,savedReviewAt}` and matching `sources[]` | The version reference is preserved. It is only labeled matching-current when recomputation agrees. An unmatched historical version is never replaced with current contents. |
| Mapping Review | Spatial `sources[].mappingReviewId`, embedded `mappingReview.id` and snapshot; provenance `reviewId` | IDs must agree. This is the inventory mapping review, not Parts Explorer Review. A displayed snapshot digest is computed for inspection, not claimed as a separately persisted verification hash. |
| Spatial | `brick-spatial-traces/<id>.json`, `task`, `requestInput.provenance.analysisId` | Direct Analysis reference and sources must agree. When a payload digest exists it must match the stored payload and explicitly preserved Analysis image bytes. |
| Geometry | `brick-spatial-geometry/<id>.json`, `planId`, `sourcePlanHash` | Hash equals SHA-256 of `JSON.stringify(plan.plan)`; saved sourcePlan/sourceInput snapshots must agree when present. Failed and no-solution results are retained. |
| Candidate | Embedded Geometry candidate `id` | Identity is **(geometryId, candidateId)**; `candidate-1` alone is not globally unique. Diagnostic candidates remain diagnostic. |
| Layout Selection | `brick-spatial-selections/<id>.json` | Analysis/plan/geometry/candidate references, sourcePlanHash, candidateHash and assembly snapshot are checked; existing Build Order source validation is reused. Multiple selections of one candidate remain separate nodes. |
| Saved Build Plan | `brick-build-plans/<build_plan_id>.json` | `source_selection_id`, `source_geometry_result_id`, `source_candidate_id`, `source_candidate_hash`; existing load/validation is reused. Draft/complete validation is separate from adoption. |
| Build Order Trace | `brick-build-traces/<id>.json`, `source.{selectionId,analysisId,geometryId,candidateId,candidateHash}` | Separate child of its explicit Layout Selection. Only an explicit `trace.plan.build_plan_id` and matching source references can relate it to a saved Plan. Success or temporal proximity never establishes this link. |
| Requests / Refinements | Existing spatial request and refinement records | Explicit Analysis/Plan IDs and, for Refinement, plan/input/geometry hashes. Failed attempts remain visible. |

`reviewVersion` is the existing semantic digest of `{updatedAt, rows,
hiddenParts, manualRelations}` produced by `reviewedSource`, including expanded
planning instances. It is not the whole Review file digest. `candidateHash` hashes
the entire canonical candidate using the existing JSON serialization convention.
It is not `designHash`; no Artifact design identity is invented or substituted.

The response contains transient nodes/parents, evidence summaries and unassociated
diagnostics. Review-input nodes are scoped to their Spatial run; they do not imply
that a historical full Review document exists. Neither assemblies nor plans are
copied into a second persistent store. Displayed status is the recorded status;
opening existing viewers continues their existing validation path.

## Verified Penguin records

Image: `sha256:957bfeec320e103ebccb1b05aafe44c49088a908961868b6af47f31d22965b09`.
The existing Selected relation was read as `ed37d020-0a2c-4dd4-bb29-8c3aa93cbb68`.
This operation did not create or change that relation.

The saved 11-step branch:

1. Analysis `ed37d020-0a2c-4dd4-bb29-8c3aa93cbb68`.
2. Parts Explorer Review version `39422e892278951769dcf9727ffe7c47fa4a8442b6d0987108d751c22e31665f`, saved at `2026-10-26T10:32:57.068Z`; recomputes equal to the current Review.
3. Embedded Mapping Review `54936721-39b4-495c-a8eb-0e7949c02563`.
4. Spatial `f18759ed-d4e1-45cc-b257-4ad5d71d48a8`; plan hash `7c32d1596b88c428f92240003a4fa04a34d640a8d8938635f2469db47d3bcf0f`.
5. Geometry `c34c5c9a-b513-4ce5-b87b-47cbd96154f5`, recorded `candidates_with_unverified_constraints`, with 10 candidates.
6. `candidate-1`, candidate hash `c7dc1bdd6114a4f74f7e5304c49c103069340544f7161a450b7e053f72ef82bb`.
7. Layout Selection `77d99b0e-9c62-4ba6-b655-bcf1a8db5828`.
8. Build Plan `426f27c7-a9a9-4ee9-9965-39e1cd9e30f8`: **draft**, 11 steps, existing validation `valid=true`, `complete=true`. It was not promoted or newly adopted.

Selection `c97485fc-166c-4e0c-ab31-156d9467564e` references the same geometry and
candidate independently, and has no saved Build Plan. It is not another Geometry run.

Analysis `ed37d020…` also produced Spatial `b02871ca-e1ed-43ef-a416-9ba6dff25b74`
using historical Review version `5e0fb3f825013e7e3aea077d1f3e641038823adbcb503c0e83b73ba2662dbaac`
and Mapping `955a5828-2a31-4d10-aa9a-997200d2d34b`. Its Geometry
`92f06430-a17a-4711-bd1f-7d251461564e` is `no_solution`. That Review version does
not match the current Review; its full historical file cannot be reconstructed.

Analysis `80a0ad1a-db21-4f5d-ba3b-96215e1aed83` owns three different Spatial records
(`966c3208…`, `b052f246…`, `b774d098…`) and five Geometry attempts, including
`budget_exceeded` and `no_solution`, plus a failed planning request and Refinement.
It does not inherit the other Analysis's Build Plan. `abf0baf5…` and `1b9a8805…`
have no linked downstream records in the scanned canonical stores.

Build Order Trace `5fac7f3e-fb38-40bb-bd48-ef5268aacc3a` explicitly references
Selection `77d99b0e…`, but is `provider_or_trace_failed` and has no output Plan.
There is no evidence that it generated saved Plan `426f27c7…`; the UI shows them as
separate records under their common explicit Selection.

## Remaining gaps and limits

- Full historical Parts Explorer Review snapshots were not persisted. A version
  reference and the actual planning input/mapping snapshot are available, but are
  not interchangeable with the whole historical editable Review.
- Some old Analyses lack formal sourceImageId. Their downstream records cannot be
  placed under this image. Missing references, conflicts and malformed records
  appear in a **global unassociated** diagnostic section, not a guessed image group.
- Revision-derived Geometry needs the additional approved Revision evidence chain.
  This V2 refuses to attach such geometry directly to its original Spatial Plan and
  explicitly reports the gap. No Penguin Geometry in the verified chain uses this path.
- Saved Build Plans lack a backlink to generation Trace. Where a Trace preserves
  the exact output Plan ID, that explicit forward reference is usable, but does
  not prove that later edited content equals the generated draft. Penguin has no
  such successful Trace reference.
- This view currently covers the assembled Parts Explorer spatial workflow. It
  does not invent spatial ancestry for loose inventory results or legacy Artifact
  designs. No new schema or generation-path modifications were necessary.

## API and UI

GET `/api/brick-source-images/:imageId/workflow-history` projects canonical data
on demand. POST is rejected (405). Selected is still read/written by its existing
independent endpoint; it is not an input to lineage construction.

In assembled Parts Explorer's existing History area, choose Penguin in “按图片筛选”.
Workflow History shows all four analyses. Selected determines the initial focused
branch and changes focus on an explicit re-selection; Load never writes Selected.
Expand another Analysis to inspect its branches, or use “查看 Analysis / Review”
through the existing restore path with its unsaved-Review confirmation.

The saved Build Plan path is expanded for visibility, without selecting any
stage. Expand the failed branch and other candidates separately. “打开已有记录” uses
existing Spatial/Geometry, Build Order and Trace pages. Full IDs/hashes are in
“引用证据”; current Review and historical Review input are distinct entries. The
view refreshes after loading another Analysis and when returning to the window.

## Verification

98 scoped tests pass, including nine new lineage/projection tests, existing
History/Selected/Review, Spatial, Build Order, Build Planner and Trace tests.
The new tests use isolated copies of real Penguin records: reverse traversal,
all branches, two selections of one candidate, Review edits, hash mismatches,
missing/corrupt upstream records, independent Selected changes, explicit Trace
output identity and SSR links. No paid model calls are made.

All 263 real canonical `generated/brick-*` files retain identical SHA-256 digests before and after this work, including the existing Selected relation.

Production build passes. HTTP verified four Analysis records and the 11-step
Build Plan, GET 200, POST 405, and the existing Selected relation unchanged.
Browser connection was unavailable, so actual browser interaction remains manual.

Manual acceptance:

1. Restart the app server and open `/story-voice-test-audio/brick-inventory.html`.
2. In assembled Parts Explorer, filter Penguin; confirm Selected `ed37d020…`.
3. Follow its Review input → Mapping → Spatial → Geometry → candidate-1 → two
   separate Layout Selections; open Plan `426f27c7…` and verify 11 steps.
4. Expand `b02871ca…` and inspect the historical-version label and `no_solution`.
5. Expand `80a0ad1a…`; verify its own failed/other attempts and absence of that Plan.
6. Load another Analysis without selecting: Selected stays unchanged. Select it
   explicitly: focus changes, but all branches and their references remain intact.
7. Expand global missing-evidence diagnostics and inspect full source references.
8. Check Info Hint with hover/focus/touch and existing Review/Design Lab links.
