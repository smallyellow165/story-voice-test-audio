# Magnetic Tiles — Global Right-Side Catalog Tab V1

## Layout and interaction

The right column now has a sticky, single-line **Inspector / Tiles Catalog** tab bar. Both panel bodies stay mounted; the existing Inspector Portal host remains stable and is only hidden while Catalog is shown. Switching tabs therefore keeps the selected observation, matching results, advanced-editor expansion, undo state and unsaved Review draft. Each tab remembers its scroll position in the current session.

Catalog is globally available in Source, Review, Reconstruction, Assembly and Build. It does not change the active Workflow stage or the center workspace. The left Supported Tiles button, left Catalog profile selector, and center Catalog cards are removed. Navigation retains exactly five Workflow buttons and the original column/split resize storage keys.

The Catalog uses a compact vertical list (five rows, approximately 52px each). Each row contains an SVG thumbnail, name, ID/version, relative edge lengths and Estimated badge when applicable. Long metadata truncates with full-value hover titles. Clicking a row updates one details section below the list, containing ID/version, complete vertex coordinates, derived edge lengths/connectability and the original Estimated source text. Green thumbnail edges indicate connectable edges. All geometry and metadata come from the existing validated `profiles.json` → `profiles.ts` chain; no Profile is copied or changed.

Tabs support pointer, touch, Arrow Left/Right and Home/End keyboard navigation. The right column retains its existing independent scroll container, so existing Inspector scrolling behavior and controls remain available. The middle Parts Review / Source Evidence split is unchanged.

## UI state and URLs

Visual UI preferences use `magnetic-studio.right-panel.v1` in localStorage:

```text
{ rightTab: 'inspector' | 'catalog', catalogProfile: '<id>@<version>', lastStage: '<one of five workflow stages>' }
```

Current URLs additionally carry `rightTab` and `catalogProfile`. Explicit URL values take precedence over stored UI preferences, followed by Inspector / the first valid Catalog Profile. Tab/Profile changes use the existing `writeStudioUrl` merge with `replaceState`, so they preserve all Source, Analysis, Review, Candidate, Assembly, Build and model/source-preference parameters without introducing extra Workflow history entries. Workflow stage navigation continues using its existing behavior.

These visual writes do not emit `popstate` or reload feature controllers. Existing saved-work identities keep managing Current; server Selected references keep their existing storage, CAS and restoration rules; Review and Assembly draft storage is unchanged. The Catalog Profile is a read-only lookup choice and never assigns a part's geometry.

Copied URLs and refresh restore the explicit tab/profile independently of another tab's more recent local UI preference. Without explicit visual URL values, stored UI preference is used. Invalid visual preferences show an Info Hint and choose a valid display default without rejecting independent Snapshot IDs or assigning another part Profile. If browser storage is unavailable, the URL still carries tab/profile state.

## Legacy Catalog links

`stage=catalog` remains accepted as a legacy input, but no longer represents an active Workflow stage. It opens the Catalog tab and canonicalizes the URL to a real work stage while retaining every existing identity:

1. `buildId` → Build.
2. `assemblyId` → Assembly.
3. `reconstructionId` / `candidateId` → Reconstruction.
4. `reviewId` / `observationId` → Review.
5. `analysisId` / `sourceId` → Source.
6. A bare legacy link uses the remembered valid work stage; with no remembered stage, Assembly is the default.

The common URL reader normalizes legacy context-bearing links, so existing feature controllers and Selected default restoration see a real work stage. Ordinary URLs with an explicit real `stage` retain it. No router, Snapshot migration or new server endpoint is introduced.

## Verification

- `node --experimental-strip-types --test test/magnetic-*.test.mjs`: **67/67 passed**. Four new tests cover five-stage legacy normalization, preserved identities, explicit UI URL precedence, local visual preferences, bare legacy links and invalid visual preferences without disrupting saved-work URLs.
- `npm run build`: **passed**, including TypeScript. The pre-existing large-bundle warning remains.
- Expanded `verify-magnetic-catalog.mjs`: production UI against the existing rose Source/Analysis/Review. Verifies five exact SVGs and connector counts, names/versions/relative lengths, Estimated sources, compact row heights, all five stages, keyboard tabs, unchanged canvas and tutorial on direct tab switches, Review P1 selection / shape and size scores / unsaved color draft, copied URL and refresh, existing local-draft recovery, local UI defaults, explicit URL override, legacy links, separate per-tab scrolling, center vertical split, column dragging, minimum-width and mobile overflow.
- Catalog-specific acceptance verifies **zero Snapshot API writes**, **zero model calls**, unchanged original Analysis/Review, and byte-equivalent Selected API state before/after. Existing regression checks can create new immutable test snapshots but never rewrite prior records.
- **15 browser scripts passed**: Catalog plus Review UI, relative size, shape matching, Review table, history URLs, Selected Snapshot, full mosaic replay, Assembly, Build, partial recognition, saved Image Intake, compact navigation, Server Library and model/source preferences. All recognition calls are blocked or explicitly disabled (`MAGNETIC_LIVE=0`).

Browser artifacts: `/tmp/magnetic-catalog-tab/{review-catalog.png,minimum-right.png,narrow.png,mobile.png,result.json}`. Logs: `/tmp/catalog-tab-*.log`.

Core Profile JSON/schema, Geometry Validator, Shape/Relative Size scores, Review/Analysis business logic, Reconstruction, Assembly, Build and Selected server storage/CAS implementations are unchanged.

## Manual acceptance

1. Refresh Magnetic Tiles Studio. The left column should have five Workflow steps and no Supported Tiles button. Open the right **Tiles Catalog** tab in any stage.
2. Select all five rows. Check the edge-length labels, vertices, connectable-edge table and Estimated source for the two estimated profiles.
3. Open an existing rose Review, select P1 and click Find Matching Profile. Its leading Tall Right Triangle result remains Shape **87.8** / Size **92.3**. Optionally make an unsaved color edit. Switch to Catalog, inspect another Profile, then return to Inspector: P1, the existing matching result and the draft should remain.
4. Switch Workflow stages with Catalog active. The center should display that stage's normal workspace and the Catalog should remain accessible on the right. Existing Assembly → Build source-preview behavior is retained; direct tab switching does not change tutorial state.
5. Copy a saved Review's URL with `rightTab=catalog&catalogProfile=large-equilateral-triangle%401`, open another tab and refresh it. The saved work identities and visual selections should restore. Unsaved Review contents continue to use the existing explicit draft-recovery action after refresh.
6. Take a historical URL and replace only its stage with `stage=catalog`. It should open the right Catalog alongside the stage inferred from its existing Snapshot IDs. Bare old links also open a valid workspace.
7. Resize columns and the Review table/image split; scroll the right column independently; verify the two tab labels remain on one line on mobile. Check Selected stars/history browsing as before.

Focused commands:

```sh
npm run test:magnetic-catalog-tab
MAGNETIC_ORIGIN=http://127.0.0.1:5173 npm run test:magnetic-catalog:browser
```

No backend restart or data migration is required for this frontend change. Existing preview hosting should serve the latest build; the development server can reload the frontend normally.

## Files

Application:

- `src/magnetic-tiles/StudioLayout.tsx` — global tab bar, stable Inspector host, tab scroll and visual state persistence.
- `src/magnetic-tiles/SupportedTiles.tsx` — compact Catalog list and selected Profile details, supplied by the existing Catalog.
- `src/magnetic-tiles/studio-panel-state.ts` — visual URL/preference resolution and validation.
- `src/magnetic-tiles/studio-url.ts` — five-stage type and legacy Catalog normalization.
- `src/magnetic-tiles/main.tsx` — remove the old standalone Catalog mount.
- `src/magnetic-tiles/style.css` — compact rows/details and sticky tab bar; remove center-card styles.

Verification/documentation:

- `test/magnetic-catalog-tab.test.mjs` — visual-state and legacy URL cases.
- `test/magnetic-url.test.mjs` — assert five active Workflow stages; legacy cases moved to dedicated coverage.
- `scripts/verify-magnetic-catalog.mjs` — full global-tab acceptance.
- `scripts/magnetic-studio-browser.mjs` — navigate right tabs through UI; Inspector-bound actions explicitly open Inspector.
- `scripts/verify-magnetic-{compact-nav,library,preferences,relative-size,url}.mjs` — adapt old Catalog navigation/selector expectations. Library checks wait for the actual asynchronously loaded options.
- `package.json` — focused test commands.
- `doc/magnetic-catalog-tab-v1.md` — this report.

## Limits

Tab/profile state is visual UI state, not a new server-selected business snapshot. Browser storage does not sync across devices; copied URLs carry explicit visual state. Match results stay in memory across tab switches; after a full refresh, existing match/review recovery behavior still applies. A context-free old Catalog link cannot identify an unknown previous work session, so it uses the remembered stage or Assembly. When a legacy URL contains several work identities, the documented specificity order determines the visible stage and all IDs remain intact. Invalid or unavailable Catalog Profile bookmarks show a valid display default with a hint; no part Profile or geometry is changed.
