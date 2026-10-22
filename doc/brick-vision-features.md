# Vision physical features → Catalog review

Inventory recognition now records nullable color_id, size and shape, plus print (yes/no/unknown) on each original Observation. Both existing providers receive the shared contract. Size means the whole piece footprint, never a count of visible studs. Candidate part/color guesses remain in original diagnostics but do not populate the human confirmation fields.

The existing Workspace review row owns editable features and confirmed identity. Click 检索候选 to use the existing Catalog list, images, evidence and pagination. Known fields map to color, size, shape and printed; unknown fields are omitted. At least one known feature is required for an Observation search. No part ID is required. The existing Backend performs strict AND matching, with no fallback or automatic selection.

Choose the Catalog color (required explicitly if the feature color was unknown), quantity and 确认候选. This fills and selects the Observation row, not the Inventory. Changing the Observation, loading History or starting another search invalidates the old selection callback. Review, then use 校验并确认加入库存编辑器 and the existing inventory save action. Inventory validation checks the existing inventory format and the local Catalog part/color association. LDraw Mapping and game support are checked only in game preparation, not when adding to Inventory.

History loads original records without model calls or writes. Records lacking structured features show blank/unknown fields for manual entry; no Evidence parser or old-ID inference is used. Editable fields and candidate-choice evidence can be inspected in the Observation details alongside the untouched original data. Raw request/response diagnostics and downloads remain on the existing path.

## Manual acceptance (not executed by Codex)

1. Load an existing History record and enter physical features manually if absent. Searching and selecting candidates must not issue a Vision recognition request.
2. For newly recognized photos, verify nullable features and reference guesses in the original JSON. Unknown whole dimensions must remain unknown even if top studs are visible.
3. Search each row, inspect the candidates endpoint query parameters and its strict-match evidence. Verify omitted unknown fields, zero results without relaxation, pagination and images.
4. Use Orange + Curved Top, then add overall 2x4 if visually supported; inspect whether the actual database returns 98223. Also inspect normal 2x2 and 2x4 candidates (3437 and 3011). These are manual cases, not rules or fixed model outputs.
5. Choose a candidate and color; verify only that row is populated. Edit the row or load different History before clicking an older candidate: selection must be rejected as stale.
6. Validate selected rows, add to Inventory, then save/reload with the existing controls. Check original History remains unchanged.

## Limits

No commands, builds, tests, servers or model/API requests were run during this change. Actual model feature quality, SDK schema acceptance, database results and browser interactions require manual verification. Catalog name features are incomplete: unmarked print status is unknown, not no. A valid Catalog part/color can be saved to Inventory even when unsupported by the game. Later game preparation may still reject its LDraw/runtime Mapping; supported game parts/colors and Validator/Generator behavior are unchanged.

Observation review uses a compact responsive list with a metadata line, feature fields, confirmed identity/quantity fields and per-observation actions. Narrowing the Workspace wraps fields instead of creating a wide table. BBox selection continues to target data-observation-id. Verify multiple rows, narrow panels, Catalog selection, Inventory save/reload, and unchanged original History in the browser; these checks have not been run.
