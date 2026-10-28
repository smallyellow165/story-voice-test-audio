# Selected Spatial Planning V1

## Scope and identity

A Spatial choice belongs to an exact, persisted planning input, not a Source Image
or Analysis alone. `selectionKey = "sha256:" + SHA256(JSON.stringify(identity))`:

```text
identity = {
  schemaVersion: 1,
  sourceImageId,
  analysisId,
  reviewVersion,
  mappingReviewId,
  mappingSnapshotHash,
  inputSnapshotHash,
  imagePayloadSha256
}
```

`mappingSnapshotHash` hashes the embedded `sources[0].mappingReview` and
`inputSnapshotHash` hashes the entire `requestInput`, with the existing
JSON.stringify SHA-256 convention. This includes recorded Review save evidence,
geometry, mapping, visual evidence settings and manual guidance. Field-order or
snapshot differences are not normalized into guessed equivalence. Model, Prompt,
run ID and generated Plan are not upstream identity, so repeated outputs of the
same exact input share a choice scope even when generation settings differ.

The explicit Analysis/Review/Mapping identity is checked against `sources[]`.
Mapping rows, IDs, confirmed part/color identities, targets and quantities must
match the actual input instances. The recorded image payload hash must match its
bytes and one explicitly preserved Analysis image payload; canonical original
Source Image verification still uses original bytes. No current Review is read or
substituted to establish historical input identity.

This is deliberately strict: the existing generator creates a new Mapping UUID
for each run. Consequently, the five real Penguin Spatial records are **five
independent scopes**, even where Review versions agree. We do not collapse distinct
Mapping identities based on matching appearance/content. Demonstrating same-scope
switching uses isolated duplicate run records preserving exactly the same input.
Producing multiple such runs in the normal generator would require an explicitly
designed reuse of the same saved mapping/input snapshot; this change does not alter
the generation path or fabricate that relationship for old runs.

## Persistence and validation

`generated/brick-spatial-plan-choices/<selection-key-hex>.json` contains:

```text
{
  schemaVersion: 1,
  selectionKey,
  identity,
  selectedSpatialPlanId,
  revision
}
```

Absence means no user choice (revision 0). Each input has one record. There is no
second History index. Load is read-only. Original Spatial, Analysis, Review,
Geometry, Layout Selection and Build Plan records are never rewritten.

GET `/api/brick-spatial/plan-choice/:planId` verifies input identity and returns
scope, eligibility and choice. POST takes `{selectionKey, expectedRevision}` to
explicitly select the path's Plan. Same-origin checks use the existing Spatial
route guard. Scope mismatch, invalid provenance, missing records and failed
validation reject the write.

Eligibility reuses the existing `planView().usable` without changing its logic:
raw JSON output must equal the saved Plan; existing validatePlan must pass;
recorded validation, parse/finish/wire status must all permit execution. A valid
Spatial Plan can be selected even if Geometry subsequently finds no solution.
No Geometry, Candidate or Build Plan is selected by this action.

Exclusive per-scope file locks, optimistic revision checking, a second input/Plan
check immediately before writing, and atomic rename protect concurrent writers.
Stale writes get 409, with no automatic retry. Failed selection leaves the prior
choice intact. Corrupt existing choice/target records fail explicitly. A crash
may leave a lock; an operator must confirm no writer exists and inspect/remove it,
not rely on runtime age-based recovery.

## Real Penguin audit

| Analysis | Spatial Plan | Stored state | Select eligible |
| --- | --- | --- | --- |
| `ed37d020…` | `f18759ed-d4e1-45cc-b257-4ad5d71d48a8` | plan_ready_for_review | yes |
| `ed37d020…` | `b02871ca-e1ed-43ef-a416-9ba6dff25b74` | plan_ready_for_review | yes |
| `80a0ad1a…` | `966c3208-b20f-4e73-89be-f8c390fefa65` | plan_ready_for_review | yes |
| `80a0ad1a…` | `b052f246-bce4-4a43-93aa-69de7572c0fe` | plan_ready_for_review | yes |
| `80a0ad1a…` | `b774d098-b19e-48e7-b827-49ccf204b864` | prepared | no |

All five have sufficient saved input identity, but distinct Mapping Review IDs.
No real choice was created by this implementation or its tests. The existing
Selected Analysis remains unchanged. The `f18759ed…` branch retains its Geometry,
two separate Layout Selections and the 11-step Build Plan documented in Workflow V2.

Older plans lacking formal Review version or Mapping snapshot fail scope discovery;
they remain viewable in existing History. Missing full historical editable Review
files do not require reconstruction: this feature uses the version reference and
actual persisted input snapshot. It does not claim to restore the whole old Review.

## UI

In Parts Explorer, filter Penguin and expand Workflow History for the desired
Analysis. Open its Spatial Plan in the existing Design Lab. Spatial Planning
History now shows time, short ID, status and any Selected marker. Choosing a row
automatically loads it; the button below separately adopts the current run.
The UI shows current viewed ID, the selected ID for that input, and expandable
input identity evidence. Different input scopes can each show their own Selected.
A run failing formal validation remains viewable, with Select disabled.

Switching away from a loaded plan asks a conservative confirmation before replacing
the preview or potentially losing unsubmitted manual edits; no edit state is guessed.
The previous history/current-Review refresh remains available under secondary
“历史读取操作”, not a permanent primary button. Selection-state read retries appear
only on error. Window focus reloads choices; POST success synchronizes all listed
runs sharing that scope. Returning to Parts Explorer refreshes Workflow History,
which annotates only the Spatial node and retains all actual downstream branches.

Manual acceptance:

1. Restart the app server; open assembled Parts Explorer, choose Penguin and its
   Selected Analysis `ed37d020…`; open Spatial `f18759ed…` from Workflow History.
2. Inspect the loaded plan, then Select. Verify its short ID under “此输入的 Selected”.
3. Choose `b02871ca…`: after confirming the switch, it loads but is not automatically
   selected. Its different input scope is visible in details. Selecting it does not
   replace the choice for `f18759ed…` because they are different inputs.
4. Reload the page or restart the service. Each selected scope restores separately.
5. Return to Workflow History: selected Spatial markers appear with their original
   Geometry/Selection/Build Plan branches; no downstream stage becomes Selected.
6. On `80a0ad1a…`, load prepared `b774d098…`: viewable but cannot Select.
7. Same-input switching and stale-tab conflicts are covered by isolated test runs;
   current real Penguin records do not prove a shared input scope. Do not duplicate
   production records merely to demonstrate switching.

## Validation and changed files

108 scoped tests pass, including ten new tests for shared exact-input runs,
independent versions, rejected runs, concurrency/restart, corrupt choices,
Penguin eligibility, unchanged lineage, UI controls and Workflow Selected markers.
Tests use temporary copies and independently constructed run/version variants;
no paid LLM calls or real history mutation. Production build passes. HTTP checks:
GET 200 with no initial choice, invalid revision 422, foreign Origin 403.
All 263 pre-existing canonical brick files retain identical SHA-256 digests.
Browser connection was unavailable; actual clicks/hover and visual layout remain
manual acceptance items.

Implementation: `server/brick-selected-spatial.mjs`, API wiring in `server.mjs`,
export of the unchanged existing `planView` helper, read-only Workflow annotations,
`SpatialPlanningHistory.tsx`, existing Spatial/Workflow UI integration, test helper
and `test/brick-selected-spatial.test.mjs`. No universal selection framework,
source schema migration or validator relaxation was introduced.
