# Observation compact table acceptance

Manual interaction checks; not executed by Codex. Use existing History records, not new model requests.

- Load 10–20 Observations: one table row per object, all eleven columns visible by widening Workspace or scrolling the table horizontally. Check that rows stay single-line and controls do not overlap. The Workspace retains its existing vertical scroll; Catalog below is unchanged.
- Click a BBox: the matching row becomes highlighted and scrolls into view. Click a row's non-control area or ID: its BBox becomes highlighted. While a different row is highlighted, edit an input, change Shape/Print, toggle a checkbox or open More Actions: the highlight must not jump to that row merely from event bubbling.
- Open More Actions on the first/last visible row and at the right viewport edge: all four actions remain available outside the scroll clipping. Click outside or press Escape to dismiss. Use Tab/Shift+Tab to reach actions, Enter to activate. Scroll the table/Workspace or resize the window while open: the menu closes instead of remaining at a stale position.
- 检索候选 opens the existing Catalog candidate flow. Confirm a candidate and verify the corresponding row receives its part/color. 检索并回填 and 检索并回填所有 retain the existing unique-result, partial-field completion and no-overwrite rules. No model request should occur.
- Check zero/multiple/error outcomes: the row shows a short status; hover the status for the complete message or open 查看详情 for catalogSearchNote, original Observation, review draft and validation. Raw diagnostics/download remain accessible.
- Delete from More Actions and verify only the intended row/BBox disappears. Verify actions that modify data are disabled while busy or already applied; 查看详情 remains usable.
- Manually select intended rows, run the existing inventory validation/confirmation, then save and reload Inventory. Automatic fill alone must not add items or save Inventory.

The menu uses the browser native Popover API (top layer), without a new UI dependency. Actual browser support, visual placement, keyboard/focus behavior and all flows above still need manual verification. No commands, builds, tests, server starts or API calls were executed for this UI change.
