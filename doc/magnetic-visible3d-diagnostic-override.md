# Visible 3D Diagnostic → Assembly

旧 Override / Human Accepted Diagnostic 授权机制已删除。当前流程与调查结论见 [magnetic-direct-operations.md](magnetic-direct-operations.md)。

选择 Diagnostic 后点击“打开 Diagnostic 到 Assembly Editor”，即可编辑、保存、加入 Gallery 和手工编排教程。不再要求 override/humanAccepted 参数、Checkbox、grant 或 Revalidate 凭据。`open-diagnostic-draft` 仍检查当前来源、Execution Hash、Candidate 身份与重放快照；新 Origin 的 entryMode 为 `diagnostic-draft`。连接与碰撞错误均可在 Editor 修正，严格 Invalid 不改变。

Photo Match、实体碰撞与理想几何的诊断保留原样。正常 Candidate 路径仍只接受实际 Geometry Valid 的 Candidate；Diagnostic 使用自己的显式打开入口，不冒充 Valid。

旧来源和 Saved Assembly 继续按原字节、版本及 Hash 读取，不迁移、不伪造授权、不修改几何数据。Revalidate 只是重新显示当前 Validator 结果，保存和展示不以其结果或凭据为条件。

自动化：`checks/magnetic-3d/diagnostic-override.vitest.ts`、`test/magnetic-visible3d-override.test.mjs`、`test/magnetic-direct-operations.test.mjs` 和 `scripts/verify-magnetic-assembly-actions.mjs`。
