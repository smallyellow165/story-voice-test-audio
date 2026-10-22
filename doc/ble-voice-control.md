# WZKJ01 BLE Voice Control — Activity V1

实现已写入，未执行命令、测试、构建、启动服务、发布或真实 BLE 操作。以下步骤供用户执行，不能视为测试通过。

## 复用架构

沿用 Brick / Hopscotch / Simon Says 的 Package Export、ScreenGameActivity 动态 mount、GamePresence、ActivityLink 和 ActivitySession。未增加传输通道、Python 蓝牙连接、独立服务或新 pipeline。

语音路径：现有 STT → LLM `ble_switch_action` → `ActivitySession.command('ble_control')` → 原 RTVI `activity-command` → ActivityLink → Test Audio BLE Activity → 原 `BleConnection` → `writeValueWithResponse()` → 原 `command_result` / `activity-result` → LLM 自然回复。

活动内手动控制按钮通过同一个 `ActivityLink.gameAction('ble_control')` 路径进入浏览器 Core。未连接语音时，沿用 ActivityLink 的本地命令路径。浏览器负责状态、Service/Characteristic、六条 HEX、日志和实际写入，Python 只有语义操作名称，不复制设备协议。连接/授权按钮必须由本机用户点击，不经 LLM。

独立 `/story-voice-test-audio/ble-test.html` 保持原功能，并继续调用相同 `BleConnection` 方法。**语音验收须在 V4 内加载的 BLE 面板连接设备**；另一个标签页的 BLE 连接不会跨页面共享，也不应让独立测试页/nRF Connect 同时占用设备。V4 与独立页 origin 不同时可能需要分别授权。

## 文件与职责

Test Audio：

- `src/ble-test/connection.ts`：六个现有写入方法增加结构化结果（applied/rejected、GATT 回应和物理状态未确认），保留协议与 UI 日志。
- `src/ble-activity-core.ts`：使用现有 Activity v1 信封；持有当前 controller、revision、输入引用和少量结果描述。
- `src/ble-switch-module.ts` / `.d.ts`：浏览器 UI 和 mount/receive/snapshot/restore/setEnabled/unmount 契约；不自动连接，不自动发送动作。
- `src/activity-bridge.ts`：原同步接口兼容保留，允许 action 返回 Promise，等待实际结果后回执；增加执行中 commandId 去重。
- `src/game-permissions.ts`：`ble_control` 使用已有 `canControlGame` 权限。
- `package.json`、`vite.module.config.ts`：导出 `story-voice-test-audio/ble-switch`。
- `test/ble-activity.test.mjs`：六条指令、重复 ID、过期 revision、未连接、失败、恢复与权限丢失测试。

V4：

- 原 `page.tsx`、App、GamePresence、ScreenGameActivity、game-start：菜单与动态模块入口。没有额外的 BLE 通信实现。
- `server/src/ble_switch_tools.py`：复用 Brick 的 user-turn key，冻结本轮引用并在 await 前消费，调用既有 ActivitySession。
- `server/src/activity.py`：BLE 活动/命令白名单、每轮输入投影；不改 pipeline。
- `game_permissions.py`、`persona_tools.py`、`persona_capabilities.py`、`server/personas/game.md`：权限、工具注册和语义约束。
- `server/tests/test_ble_switch.py`、`client/src/app/components/ble-switch-link.test.mjs`、game-start 测试：服务端语音绑定及真实 Core/ActivityLink 契约测试。替身仅位于测试文件。

## 去重与结果语义

1. Brick 同款 `instanceId/runId/taskAttemptId/revision` 引用：用户输入首次推理时绑定；手动操作或连接变化使旧引用失效。
2. 每轮用户输入最多一次 BLE 工具执行，在 await 前预留；失败、超时也不自动重试。新的明确用户轮可以再次发出动作。
3. ActivitySession 沿用 pending command、sessionEpoch、权限和预期 revision 检查。
4. 浏览器桥接保留完成结果的 commandId 缓存，并忽略执行中的相同 ID；BLE Core 在异步写入前消费引用，旧引用即使用新 commandId 也不能再次写入。
5. 六条命令仍共用原 controller 写入锁。只收到 GATT Write Response 后才返回 applied；未连接明确返回 `ble_not_connected`。失败或超时不等于设备一定没有动作，不自动补发。

工具结果明确区分 `gattWrite=completed` 与 `physicalAction=unconfirmed`、`timerState=unknown`。回复应为“指令发过去了，看看设备动了没有”，不能声称机械动作完成或定时已启用。Timer 是 Toggle，不根据历史推断 Enable/Cancel。A/B 是相反方向，不命名 Open/Close。

## 用户启动

使用已配置好的原 V4 环境和 provider 凭据。BLE 无新增 API Key，前端不需要 Test Audio 后端服务来执行蓝牙控制。

```bash
cd ~/min-wrk/projects/story-voice-lab/story-voice-test-audio
npm run build:module
```

```bash
cd ~/min-wrk/projects/story-voice-lab/story-voice-pipecat-poc-v4/server
uv run bot.py
```

```bash
cd ~/min-wrk/projects/story-voice-lab/story-voice-pipecat-poc-v4/client
npm run dev
```

现有 client `predev` 也会执行 `reading:prepare` → Test Audio `build:module`；不增加准备脚本。使用当前本地 package 链接，确保导出已重新构建。若服务已启动，请用户自行复用或重启。

本机可打开 `http://localhost:3000`（以用户实际端口为准）。Android Chrome 必须访问 **V4 页面的受信任 HTTPS origin**，复用现有 HTTPS 代理与语音连接配置；不能用电脑局域网 HTTP 地址。Standalone Vite 的证书设置不自动覆盖 V4 Next 服务。确认浏览器 Web Bluetooth 可用且 Secure Context 检查通过。

## 手动验收

1. 首轮优先使用同一浏览器的 SmallWebRTC、Player 角色，连接 Pipecat 等待 ready。Games 选 “WZKJ01 · 蓝牙开关”，Launch。也可说“打开 WZKJ01 蓝牙开关”，由现有 start_game 打开活动。
2. 在 V4 活动内点击 **Connect BLE**，选择 WZKJ01，确认 Connected。不会因为打开活动、同步状态、恢复镜像或语音连接自动动作。
3. 点击 Action A/B，确认原来两个方向的行为；核对 BLE 日志 HEX/Write Response 和 Activity 回执。
4. 分别说“向 A 方向转”“向 B 方向转”，确认每轮只触发一次，对应手动按钮的相同动作。不要同时夹杂其他操作。
5. 分别说“把开关定时切换到 30/60/90/120 分钟”，观察青/绿/红/紫 LED；再次明确要求同一 Timer Toggle，观察取消。语音回复不得声称知道真实定时状态，也不应启动助手自己的倒计时。
6. 点击 Disconnect BLE 后说“向 A 方向转”，应明确提示未连接，无写入。关闭设备电源也应同步断线；再次连接必须由用户手动完成。
7. 一个语音轮重复工具调用/同 commandId 重传不得重复动作。语音推理中手动操作后，旧语音引用应 rejected；失败/超时不得自动补发。
8. 断开/重连语音时检查状态同步；退出活动后应释放 BLE。整页刷新、Authority 换设备后不恢复虚假的 Connected，需当前浏览器实际连接。

## 用户可执行的离线检查（本轮未运行）

```bash
cd ~/min-wrk/projects/story-voice-lab/story-voice-test-audio
node --experimental-strip-types --test test/ble-connection.test.mjs test/ble-activity.test.mjs test/activity-bridge.test.mjs
npm run build:module
```

```bash
cd ~/min-wrk/projects/story-voice-lab/story-voice-pipecat-poc-v4/server
uv run pytest tests/test_ble_switch.py tests/test_activity.py tests/test_brick_building.py tests/test_game_permissions.py
```

```bash
cd ~/min-wrk/projects/story-voice-lab/story-voice-pipecat-poc-v4/client
node --test --experimental-strip-types src/app/components/ble-switch-link.test.mjs src/app/components/game-start.test.mjs src/app/components/activity-link.test.mjs src/app/components/brick-building-link.test.mjs
npx tsc --noEmit
```

## 限制

尚未实际运行 TypeScript/Python 检查、打包、浏览器、语音识别/工具选择和真实 BLE 验收。既有六条 HEX 未更改。没有 Notify、State Query 或物理动作完成反馈。
单设备 SmallWebRTC 是首轮验收范围。Daily 沿用已有 Authority/权限机制，但 Bluetooth 连接不会从一台设备迁移到另一台；多端交接、断线时序仍需另行验证。只允许当前权威浏览器执行控制。
仍采用原 ActivitySession 的结果等待超时；超时是结果未知，不是允许自动重试。整页重建不持久化执行中的物理动作事务，也不回放旧命令。
