# Magnetic Tiles — Review UI Simplification V1

## Result

The existing Review stage keeps its three columns, resizable Parts Review / Source Evidence split, independent scrolling, selection links, filters, immutable Review snapshots and URL restoration.

The Inspector now starts with a compact Known / Unknown / Excluded summary, the selected part's Profile, and a primary **Find Matching Profile** button. Selecting a different part returns the Inspector to the top so the primary action remains visible. Long limits and score formulas use the existing `InfoHint` component (hover, focus, or click). Analysis input category / correction reason, per-part evidence / contour editing, and relation editing remain available in collapsed sections. Reference IDs, scale measurements, uncertainty, outliers and candidate geometric diagnostics remain expandable.

## Matching

The outline-confirmation checkbox and display/application gate are removed. Clicking Find Matching Profile directly displays scores for any computable contour, including low-confidence or uncertain observations. A short Warning states that scores are advisory; its Info Hint preserves the original uncertainty. Invalid geometry displays the existing matcher's specific reason and no candidates. Low scores do not prevent manual application; incompatible vertex counts still require contour correction or explicit dropdown editing.

The Catalog, `profile-match.ts`, `relative-size.ts`, Geometry Validator, Reconstruction and Build algorithms are unchanged. Explicit Profile selection/application supplies the existing session-only reference-confirmation input to the size estimator; simply viewing candidates does not confirm a reference. The former checkbox no longer controls this state. Reference confidence, quality, ambiguity, square preference, robust aggregation and score formulas are retained. References are recalculated from the current Review draft.

Rose measurements remain:

| Observation / recommendation | Shape Score | Relative Size Score |
| --- | ---: | ---: |
| P1 / Tall Right Triangle | 87.8 | 92.3 |
| P2 / Large Equilateral Triangle | 100.0 | 100.0 |
| P3 / Tall Right Triangle | 86.3 | 92.6 |

P2's Standard Equilateral alternative still has Shape 100.0 and Size 0.1. P2's estimated hidden corners and the original uncertainty are retained; direct score visibility does not resolve those risks.

## Part management

- **新增零件** sits in the fixed Parts Review title row beside **保存审核快照**. It uses the existing manual ID generation, initial square geometry, `origin: manual`, draft and save path. Adding clears table search/filter restrictions and selects the new row/outline/Inspector. The 25-part limit is retained. There is no duplicate Inspector add entry.
- **删除零件** appears only for manual parts in the selected part's Inspector. An inline confirmation names the part and counts affected relations. Cancel makes no change. Confirm removes the part and every incident relation, clears the relation target and selects an existing neighboring part (or no part when empty). No deleted Observation ID is left selected in the URL.
- **排除零件 / 恢复零件** toggles the existing `excluded` field. Original Analysis parts cannot be deleted through this UI. Exclusion retains all evidence and relations; the existing Reconstruction path ignores excluded endpoints. Excluded parts remain available through the existing filter and can be restored.
- Adding, deleting, excluding and restoring offer **single-step Undo**. Undo restores the complete prior draft, previous selection and saved/unsaved Review status, including deleted relations. Selecting a different part does not consume it. Another edit, successful save, or opening another record ends that undo opportunity. Undo is intentionally local and is not persisted across refresh.

No schema or backend API change is needed. Saved snapshots are appended through the existing Review endpoint. Original Analysis and prior Review records remain immutable. Empty Reviews remain valid evidence; reconstruction reports that there are no usable parts.

## Validation

- `node --experimental-strip-types --test test/magnetic-*.test.mjs`: **56/56 passed**. Four new cases cover manual-removal cleanup, protection of original parts, immutable input for undo, exact exclude/restore behavior, excluded relation endpoints in Reconstruction, last-part deletion, and API snapshot lineage / persistence.
- `npm run build`: **passed**, including TypeScript. Existing bundle-size warning remains.
- `verify-magnetic-review-ui.mjs`: production UI with the real existing rose Source, Analysis and Review. Verifies primary action above the fold on desktop and mobile, no confirmation checkbox, hover help, collapsed fields, unchanged P1/P2/P3 scores, warning-only uncertainty, title-row add, relation creation, manual delete / cancel / undo, original exclude / restore / undo, saved state, URLs / new tabs / refresh, column and vertical resizing, and immutable historical evidence.
- **11 browser scripts passed**: the new Review UI check plus `verify-magnetic-{relative-size,profile-match,review,url,mosaic,catalog,tiles,build,partial,intake}.mjs`. Existing checks use the new buttons and expand the moved edit sections. Coverage includes independent scrolling / filters, full 17-part mosaic replay, original intake replay, Reconstruction, Assembly, Build and URL restoration. Intake replay explicitly uses `MAGNETIC_LIVE=0`, aborts recognition requests and does not require provider credentials. Scores, geometry and persistence assertions remain unchanged.
- Paid Vision / LLM calls: **0**; focused browser acceptance aborts recognition requests.

Screenshots and acceptance receipt: `/tmp/magnetic-review-ui/{p1.png,desktop.png,mobile.png,result.json}`. Logs use `/tmp/review-ui-*.log`.

## Manual acceptance

1. Open the existing rose Review with P4/P5/P6 confirmed, e.g. Review `622be109-1345-4abb-abf2-a97538e27cca`. Select P1 in the table. The green Find Matching Profile button is visible near the top of the Inspector.
2. Click it directly. Confirm Shape 87.8 and Size 92.3, plus a non-blocking Warning. Hover/focus/click the adjacent Info icon; expand size references or candidate evidence on demand. Check P2/P3 against the table above.
3. Click **新增零件** above the table. The manual part is selected and the Review is unsaved. Expand **连接关系编辑** to connect it to another observation. Try delete → cancel, then delete → undo. Delete again and save; the removed part and its relations should be absent after refresh or copying the saved URL into a new tab.
4. Select an original part. Only exclude/restore is offered. Exclude it, inspect it in the Excluded filter, then restore or undo. Save each state as a separate snapshot if testing persistence.
5. Expand **高级信息 / 编辑** to inspect input category / reason and retained relations; expand **零件证据与轮廓编辑** for color, original evidence and corner controls. Existing Reconstruction / Assembly / Build stages continue to operate.

Focused commands:

```sh
npm run test:magnetic-review-ui
MAGNETIC_ORIGIN=http://127.0.0.1:5173 npm run test:magnetic-review-ui:browser
```

Browser acceptance requires the existing local rose records and creates new immutable test Review snapshots. It never requests new recognition.

## Files

Application changes:

- `src/magnetic-tiles/intake/ImageIntake.tsx` — compact Inspector hierarchy, collapsed editors, top-row add wiring, single-step undo, manual delete / exclude actions, Profile assignment and selection scroll behavior.
- `src/magnetic-tiles/intake/ProfileMatcher.tsx` — direct scores, advisory warnings, Info Hint and expandable measurements.
- `src/magnetic-tiles/intake/ReviewWorkspace.tsx` — add button and immediate table Shape Scores with risk indication.
- `src/magnetic-tiles/intake/PartActions.tsx` — delete confirmation / exclusion / restore controls.
- `src/magnetic-tiles/intake/review-edit.ts` — thin pure Review edits and compact status.
- `src/magnetic-tiles/style.css` — Review-only presentation.

Verification / documentation:

- `test/magnetic-review-edit.test.mjs` and `scripts/verify-magnetic-review-ui.mjs` — new coverage.
- `scripts/magnetic-studio-browser.mjs` — navigate new add location and expand editors through UI.
- `scripts/verify-magnetic-{profile-match,relative-size,review,url,mosaic,intake,partial}.mjs` — adapt existing checks to intentional UI changes.
- `package.json` — focused test commands.
- `doc/magnetic-review-ui-v1.md` — this report.

## Limits

Undo is one local step and ends at the next edit/save/context change. Exclusion is reversible with no extra confirmation; manual deletion requires inline confirmation. Matcher warnings do not prove that an estimated contour is correct. Existing same-plane scale assumptions, reference reliability criteria and strict geometric validation remain. Explicit Profile reference confirmation remains session-only, as previously; opening a saved Review does not add permanent verification metadata.
