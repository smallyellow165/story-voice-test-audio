# Saved Session Inventory → Brick Building

本轮代码连接现有 Manual Inventory、V3 Gemini Generator、V2 Validator 和 V4 Activity。
未执行 CLI、构建、测试、数据库查询、模型请求或游戏生成。用户通过 UI 选择自己的真实保存记录并验收；
没有预设验收库存，没有固定造型回退。

## 唯一数据路径

1. 在原 Test Audio origin 打开 `story-voice-test-audio/brick-inventory.html`。
   “从已保存库存生成游戏”通过现有 `loadSessions()` 读取 localStorage 的
   `duplo.session-inventories.v1`，用户明确选择记录。点击检查时重新从正式存储读取，
   不读取未保存编辑，不自动挑选名字相同的记录。
2. POST `/api/brick-games/review` 携带原始 Session（id/name/updated_at/items）。
   服务器严格解析现有契约，保存该次不可变检查快照。
3. Test Audio 调用已有 My-Good-GYM Application Server 的 `mapping-part` / `mapping-color`。
   后者复用现有 `video_seeker_db`、Catalog 和 Rebrickable 元数据缓存、限流访问方式。
   零件：官方 `/api/v3/lego/parts/{part_num}/?inc_part_details=1` 的 `external_ids.LDraw`。
   颜色：官方 `/api/v3/lego/colors/{color_id}/` 的 `external_ids.LDraw.ext_ids`。
   同时确认数据库有该 DUPLO 型号及型号颜色组合；保留来源 URL、获取时间、原始候选 ID、名称和失败状态。
4. `resolveInventoryMapping` 只接受明确、唯一且受现有规则支持的目标；不按同号、名称、RGB 或旧实验数据推断。
   多来源确实映射到同一 LDraw 型号/颜色时合计数量，原始行仍全部保留。
   任一行失败就阻止整份库存生成，绝不删掉该行或改用默认积木。
   同时检查本地 `.dat` 可读、目标颜色存在于 `LDConfig.ldr`，及 V3 库存数量边界。
5. 用户确认映射后填写描述、选择现有 Gemini 模型，POST `/api/brick-games/generate` 只传 reviewId、描述和模型。
   Generator 库存从服务端检查快照读取，不接受按钮再提交另一份库存。
   复用 `generateBrickDesign()` 和 `gemini-client.mjs`；一次检查记录至多执行一次生成。
   同一请求重复到达返回已保存结果，不再调用模型；改变描述/模型需用户明确重新检查。
   不完整/错误设计保存失败诊断，不发布可启动设计，不自动重试、替换模型或修复零件。
6. `validateBrickDesign` 从原 V3 文件移动到 `src/brick-design-validation.mjs`，原导出保留。
   服务端与浏览器引用同一函数，几何仍调用原 `assembly.ts`，没有第二套连接算法。
   检查数量、碰撞、连接、放置顺序、每个搭建前缀与现有儿童基础限制。
7. 成功结果保存为 `generated/brick-games/designs/<id>.json`，包含完整输入、映射、模型诊断、原始输出、
   Design/Steps、Validator、库存消耗与 Design SHA-256。检查和尝试分别保存在 `reviews/`、`attempts/`。
8. “在 V4 启动这个游戏”打开 V4 URL `?brickGame=<id>`。V4 通过现有 Next rewrite
   `/ringfeet-api/api/brick-games/<id>` 读取同一设计记录；Test Audio 重新校验哈希和 Validator。
   V4 不读取 Test Audio localStorage，也不接收 URL 中的整份库存或不受验证的设计。
9. 原共享 package `build:module` → `ScreenGameActivity.mount` → `ActivityLink` → Python
   `ActivitySession` mirror 继续使用。游戏核心仅在 Test Audio。

## UI 中逐层核对

- **已保存库存**：名称、Session ID、保存时间与 `part_num/color_id/quantity` 原始 JSON。
- **映射表**：来源型号和颜色名称、数量、全部候选、最终 LDraw ID、每行失败原因。
  “映射原始证据”包含实际官方响应摘要和来源，不显示 API Key。
- **模型调用**：请求/返回模型、耗时、结束原因、Token、`requestInput`（实际发给 Gemini 的 JSON）、
  `generatorInput`、原始模型输出；没有隐藏的库存默认值。
- **验证**：完整 Validator 报告，包括 usage 的 available/used/remaining 和每个搭建前缀。
- **V4**：“实际加载的库存、映射、Design/Steps 与 Validator”展开后显示同一 artifact ID 和哈希及完整记录。
  当前任务按该设计的 steps 顺序展开成“寻找这块积木”及“执行该搭建指令”两次明确确认。
  因此互动任务总数为生成搭建步骤数 × 2，不是固定四步。
- **3D**：寻找时单独展示实际目标零件/颜色；搭建时展示截至该步骤的真实设计前缀，完成时显示全部设计。
  不改变设计中的位置、颜色和连接结果；单块寻找预览居中只影响展示。
- **语音**：GameVoiceGuide 读当前已提交任务，LLM 使用现有 runtime projection。找不到、等待、提问不推进。
  按钮和语音保留同一 runId/taskAttemptId/revision/commandId 约束。
- **恢复**：快照含 `brickBuilding.artifactId/designHash/brickId/phase`；Python 仅验证并镜像这些字段。
  不同设计的快照不能恢复到当前游戏。已有 Daily 游戏与链接设计冲突时明确提示，不能静默换成旧设计。

## 用户启动（每个 Terminal 一行；代理和模块均复用现有服务）

配置前提：My-Good-GYM `.env.local` 保留 `VIDEO_SEEKER_DB_*`、数据库
`vooks_video_archive`，设置 `REBRICKABLE_CATALOG_LOCAL=1`、`REBRICKABLE_API_KEY`。
Test Audio `.env` 配置现有 `GEMINI_API_KEY` / 可选 `DUPLO_LLM_MODEL`。Pipecat 继续使用现有 provider 配置。
本轮未读取或更改这些密钥，也未确认当前账号权限。

Terminal 1 — Application Server（已确认的 goodgym Conda 环境）：

```bash
fuser -k 8001/tcp; printf '\033]0;My-Good-GYM - 8001\007'; source /home/umi/miniconda3/etc/profile.d/conda.sh && conda activate goodgym && cd /home/umi/Documents/pg/xiaozhi/My-Good-GYM && python -m uvicorn server:app --host 0.0.0.0 --reload --port 8001
```

Terminal 2 — Test Audio（先更新原共享模块，再启动现有 Node 服务）：

```bash
fuser -k 5173/tcp; printf '\033]0;Test Audio Brick - 5173\007'; cd /home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio && npm run build:module && HOST=0.0.0.0 PORT=5173 APPLICATION_SERVER_URL=http://127.0.0.1:8001 npm run dev
```

Terminal 3 — Pipecat V4：

```bash
fuser -k 7860/tcp; printf '\033]0;Pipecat V4 Server - 7860\007'; cd /home/umi/min-wrk/projects/story-voice-lab/story-voice-pipecat-poc-v4/server && COMPANION_PERSONA=game uv run bot.py --host 127.0.0.1 --port 7860
```

Terminal 4 — V4 Client：

```bash
fuser -k 4000/tcp; printf '\033]0;Pipecat V4 Client - 4000\007'; cd /home/umi/min-wrk/projects/story-voice-lab/story-voice-pipecat-poc-v4/client && RINGFEET_API_ORIGIN=http://127.0.0.1:5173 V4_LOCAL_TIMER_API=1 npx next dev --turbopack -H 127.0.0.1 -p 4000
```

不再使用仅有静态资源的 `dev:brick` 来运行此流程。测试必须在库存原来保存的浏览器和 origin 下操作；
V4 会校验共享模块的 artifact 协议版本；未重新构建时明确报错，不会加载旧固定游戏。
如果之前保存于 `http://机器IP:5173`，不要换成 `http://localhost:5173` 后误认为库存丢失。

## 正式验收

1. 打开原 Manual Inventory 页面；保存自己的“今天的积木”。不需要与任何示例库存相同。
2. 页面下方刷新已保存列表，明确选择这份记录，检查 ID/时间/每行原始数量。
3. 点击“查看库存与映射”，逐行核对官方 ID 和颜色。失败时到此为止，不点击其他模板代替。
4. 映射 Valid 后输入自己的造型描述，选择模型，点击“确认库存并生成游戏”一次。
   检查模型实际 requestInput、usage、每个 prefix validation。失败信息完整展示且没有启动入口。
5. 通过后记下设计 ID/hash，点击“在 V4 启动这个游戏”。先退出已有的其他游戏；首次验收建议 SmallWebRTC + Player。
6. V4 展开记录，确认 ID/hash、Design/Steps 与上一页一致。先用按钮完成动态任务，并检查真实 3D 目标和前缀。
7. 连接 Pipecat，重开当前游戏或点“再说一次”，再用明确确认推进。断线重连只同步状态，不重播历史事件。
   测试求助/等待不推进、同一步按钮与语音并发只推进一次、退出/重开后旧确认无效。
8. 用真实生成的 artifact 文件作为后续回归输入，不手工制作固定库存测试数据。

## 测试代码（本轮未执行）

- Test Audio `test/brick-session-game.test.mjs`：读取真实生成记录，检查真实映射、缺失/歧义/不支持目标、
  冻结库存输入、一次生成、失败诊断、读取相同设计；LLM 网络在离线测试中用注入函数隔离。
- `test/brick-building.test.mjs`：用实际设计动态计算任务总数；验证所有步骤、并发/迟到/重复确认、恢复、
  模型失败及不同设计隔离。没有写死的红蓝库存。
- V4 `brick-building-link.test.mjs` 和 `verify-brick-building.mjs` 同样读取实际设计；后者仍用真实 LDraw 模型。
- Python `test_brick_building.py` 仅构造无库存、无几何的协议回执，检查 mirror/语音引用与播报边界。

上述 JS 测试需要先由用户完成一次真实生成，并设置 `BRICK_GAME_ARTIFACT` 为 UI 展示的 ID 对应的
`Test Audio/generated/brick-games/designs/<id>.json` 绝对路径。缺少这个输入时明确失败，不提供替代库存。
用户在 Test Audio 执行 `npm run test:brick-session-game`；V4 原集成/浏览器测试命令仍可使用同一环境变量。

## 限制与未验证内容

- 这是接入现有 V3 支持范围，非通用 LDraw 连接引擎。当前 Validator 的型号、颜色、5–100 块库存、
  5–12 块设计和层高规则不变。真实库存超范围时必须失败，不能静默截断或改成受支持积木。
- 官方多候选映射不自动选一个。API 没有 LDraw 映射、账号无权限或被限流时明确失败。
- 官方元数据复用 30 天缓存；不声称所有 Catalog 零件都可映射或都适用于 V3。
- 沿用现有 Gemini 模型列表，未实际调用；指令的自然语言质量、实物可辨识性需家长验收。
  几何/库存通过不等于抗倾倒或儿童安全认证。
- localStorage 仍是原 Session 保存位置，服务端保存的是这次确认的快照；之后编辑原库存不会改写已生成游戏。
- 服务端文件持久化、默认本机共享实验环境，无家庭账户隔离；不构成生产库存服务。
- 为避免进程重启后不确定请求被再次发送，尝试前写独占 `.lock`。崩溃留下锁时显示不确定状态；
  不自动删除锁或调用第二次模型，用户检查原请求后可以明确建立新 review。
- 本轮全部运行验证待用户执行，包括构建、测试、真实 API 映射、Gemini 输出、3D、语音和恢复。

## 修改文件

Test Audio：`server/brick-mapping.mjs`、`server/brick-games.mjs`、`server.mjs`、
`server/brick-generator.mjs`、`src/brick-design-validation.mjs`、`src/brick-game-contract.ts`、
`src/brick-test/design-types.ts`、`src/brick-inventory/GamePreparation.tsx`、`InventoryPage.tsx`、`inventory.css`、
`src/brick-building-core.ts`、`src/brick-building-module.ts`、`.d.ts`、`package.json`、相关测试和本文档。

My-Good-GYM：`api/rebrickable_catalog.py`、`api/rebrickable_media.py`，增加官方映射元数据查询，复用已有 DB/缓存。

V4：`client/src/app/page.tsx`、`components/App.tsx`、`ScreenGameActivity.tsx`、`activity-contract.ts`、
`server/src/activity.py`、`game_voice_guide.py`、`server/personas/game.md`、相关集成/浏览器/Python 测试。
ActivityLink、Game Runtime、Gaming Tools、Pipecat pipeline 没有新增平行实现。
