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

## Auto Build Order V1

在左栏选择已保存的 Valid Layout 后，点击 Generate Build Order。按钮旁显示服务端 Model Registry 提供的 OpenAI / gpt-6.1-sol / reasoning medium；配置不可用时不调用，也不切换模型。

生成只在点击后执行一次。已有未保存草稿会先提示；失败保留草稿。成功得到通过结构、实例、依赖和跨组件连接检查的 Draft，尚未 Reviewed，也未写入 Build Plan 保存目录。用现有 Save 持久化，再刷新检查。

企鹅首次对照：选择 77d99b0e-9c62-4ba6-b655-bcf1a8db5828，不载入测试模板，点击 Generate。应得到覆盖 12 个实例的 11 次合并；检查子组件、Previous / Next / Replay 和最终姿态，然后人工保存。生成结果不必与人工模板相同。

右栏最近 Auto Build Order 可查看状态、Validator、实际 Token Usage 和统一 Trace 链接。Trace 来源为 build，独立文件位于 generated/brick-build-traces：<id>.json、<id>.request.json、<id>.response.txt。Parsed Result 中区分模型解析输出、转换后的 Plan 和校验结果。网络响应丢失时先查看 Trace，不要直接重复付费生成。

输入无照片或 DAT 网格，仅使用已校验源布局、去重 Profile 摘要及最终连接图。输出不能更改身份、数量或最终坐标。安装路径、中间稳定性、握持空间与儿童独立操作能力仍未验证，Motion 是示意。

本轮仅编写代码和 test/brick-build-planner.test.mjs，未执行测试、构建、服务或付费模型调用。请自行启动/重启开发服务后验收。
