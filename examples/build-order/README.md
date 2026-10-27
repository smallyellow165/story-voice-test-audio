# Build Order V1 — manual acceptance

Entry: /story-voice-test-audio/brick-test.html?workflow=build&selectionId=77d99b0e-9c62-4ba6-b655-bcf1a8db5828

This example is an explicitly loaded, editable draft. It is not a validated physical build order. It never writes Selection, Analysis, Review, Spatial Plan or Geometry Result.

1. Open the entry after starting/restarting your normal development server yourself. The source must pass the saved Selection/candidate hash and Geometry Valid checks.
2. Click “从此布局新建 Build Plan”. Confirm 12 distinct instances. The draft is incomplete and playback is disabled.
3. Either use Moving/Target + Add Step to build your own tree, or click “载入可编辑的企鹅测试步骤”. The example has 11 merge steps, including whole-wing and head subassemblies.
4. Select a step, inspect both DAT views, then Replay. Ghost and green moving geometry use the same immutable final layout. Test a motion offset and nonzero start yaw; the component moves as one rigid body. Motion is illustrative, not collision-tested.
5. Previous/Next and Replay must restore from source poses without drift. Complete the last animation and compare all 12 final transforms with candidate-1.
6. Reorder independent subassemblies. A dependency-breaking reorder, reused leaf, or merge without saved cross-component connector evidence must be rejected.
7. Save Build Plan, refresh the URL with buildPlanId, and verify steps/notes/motion hints remain. Edit and save again. Save an incomplete draft separately and verify it cannot play or be marked reviewed.
8. Open a second tab with the same saved plan: an outdated save must be rejected rather than overwrite another tab's update.
9. Verify the original Design Lab manual viewer, Geometry Issues highlight and source records remain unchanged.

Storage: generated/brick-build-plans/<build_plan_id>.json. Only user-initiated Save writes a Build Plan. No automatic plan or layout generation.

Schema: schema_version=1; build_plan_id; source_selection_id; source_geometry_result_id; source_candidate_id; source_candidate_hash; title; status=draft|reviewed; instanceIds; assemblyNodes; steps; rootNodeId; created_at; updated_at.

Leaf: {id: "part:<instanceId>", kind: "part", instanceId}.
Assembly: {id, kind: "assembly", children: [targetNodeId, movingNodeId]}.
Step: {stepId, movingNodeId, targetNodeId, resultNodeId, description, motion?}.
Motion: {offsetLdu:{x,y,z}, startYawDegrees}; default (0,120,0), 0 degrees. Only the temporary starting pose changes.

Completeness is derived, not stored as approval. Reviewed is human step review only; path clearance and intermediate physical stability are unverified.

Implementation-turn verification: source inspection only. Tests in test/brick-build-order.test.mjs were written but not executed; no build, browser verification or server was run, per request.
