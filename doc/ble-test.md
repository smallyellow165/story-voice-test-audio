# Web Bluetooth V5 — WZKJ01 自动连接与控制测试

页面：`/story-voice-test-audio/ble-test.html`。复用现有连接与 `writeCommand()`，不调用后端或模型 API。

- Device Name：`WZKJ01`（精确名称过滤）
- Service UUID：`fa879af4-d601-420c-b2b4-07ffb528dde3`（在 optionalServices 声明）
- Write Characteristic UUID：`b02eaeaa-f6bc-4a7e-bc94-f7b7fc8ded0b`
- Write Method：`writeValueWithResponse()`，HEX 转为 10 字节 Uint8Array。

六个控制按钮共用当前 GATT 连接、Service、Characteristic 和同一个 `writing` 锁。仅 Connected 且无待完成写入时可发送；服务发现到响应完成期间全部控制按钮禁用。每次有效点击只写一次，不排队、不重试、不循环或自动触发。
日志记录时间、操作名称、完整 HEX、两个 UUID，以及 Write Response 或错误信息。
Write Response 仅证明 GATT 写入完成，不代表实际动作成功。写入失败也不能证明设备没有执行；现场观察后再决定是否重试。
不实现 Notify、State Query、初始化或时间同步。

## V5 自动连接

页面初始化时调用原生 `navigator.bluetooth.getDevices()`，只检查当前 origin 已授权且名称精确为 WZKJ01 的设备。
优先选择与上次成功连接的 Browser Device ID 唯一匹配的设备；否则仅在列表中只有一个 WZKJ01 时自动连接。多个目标无法明确区分时，保持 Disconnected 并提示点击 Connect 手动选择。不会自动打开授权选择器。
自动与手动连接共用 `connectDevice()`、同一个连接锁及原有 GATT / 断线监听逻辑；Checking、Selecting、Connecting 期间禁用 Connect，避免并发。手动流程仍直接从点击调用 requestDevice，保留用户手势。
不支持 getDevices、没有授权设备、权限错误或 GATT 失败时保留手动流程；若 Web Bluetooth 本身不可用或非安全上下文，显示原有环境错误。

成功连接后将 ID 保存到 localStorage 的 `ble-test:last-device-id`。仅保存浏览器 ID，不是 MAC，也不授予权限。存储读写失败会记录日志，不中断连接；无法读取 ID 且有多个目标时交给用户选择。
授权和存储受浏览器 profile / origin 限制：请保持相同协议、域名和端口。清除站点数据、撤销授权或切换浏览器可能需要再次授权。
每次页面生命周期只尝试一次自动连接；主动 Disconnect 和意外断线均不自动重连，用户可点击 Connect 恢复。刷新或重新打开页面会开始一次新的自动尝试。
日志区分 Auto Connect、Manual Connect、Manual Disconnect、Unexpected Disconnect，失败保留错误名称与信息。断线事件本身不提供具体原因，不把电源关闭或超出范围当作已知事实。
getDevices 返回已授权设备，不保证设备已开机或在范围内；自动连接仍可能失败。没有后台扫描、重试循环或自动控制写入。
API 依据：[MDN getDevices](https://developer.mozilla.org/en-US/docs/Web/API/Bluetooth/getDevices)。

## V5 手动验收

1. 首次进入同一 HTTPS 页面，点击 Connect 授权并连接 WZKJ01，确认 Manual Connect 成功日志。
2. 刷新，再关闭并重新打开页面，分别确认 Auto Connect 成功，且不出现选择器。
3. 点击 Disconnect，确认保持 Disconnected、不自动重连；点击 Connect 可手动恢复。
4. 关闭设备电源，确认意外断线日志和状态；设备关闭时刷新，检查自动连接失败后可以手动 Connect。
5. 自动连接成功后逐个验证 Action A/B 和四个 Timer，检查写入日志；断开后全部控制按钮禁用。
6. 若授权了多个 WZKJ01，确认优先连接上次成功设备；无有效记录时应提示手动选择。
7. 检查 getDevices 不支持或无授权时的回退说明，以及连接失败的具体错误日志。

离线测试覆盖自动/手动互斥、一次性尝试、多个设备筛选、ID 保存与存储失败、连接失败回退、断线与卸载竞态，以及自动连接后的六条控制命令。Android Chrome 的授权保留、getDevices 可用性及刷新/重开实际连接效果仍需实测；本轮不启动服务或操作设备。

## 六条协议命令与验证状态

| 操作 | 完整 HEX | 行为及验证状态 |
| --- | --- | --- |
| Action A | `fe01000632010100ff46` | 用户最新实测确认：机械臂向方向 A 旋转。 |
| Action B | `fe01000632010100ff47` | 用户最新实测确认：机械臂向相反方向 B 旋转。 |
| 30min Toggle | `fe01000632010100ff08` | 预期青色 LED、30 分钟定时；用户已验证 Web Bluetooth 写入及 LED 变化。 |
| 60min Toggle | `fe01000632010100ff1c` | 预期绿色 LED、60 分钟定时；用户提供此前 HCI Log / Wireshark / nRF Connect 逆向记录，React UI 实物验收待完成。 |
| 90min Toggle | `fe01000632010100ff5a` | 预期红色 LED、90 分钟定时；来源同上，React UI 实物验收待完成。 |
| 120min Toggle | `fe01000632010100ff4a` | 预期紫色 LED、120 分钟定时；来源同上，React UI 实物验收待完成。 |

命令来源为用户提供的协议调查记录及后续实测反馈，未猜测或扫描其他命令。
Action A/B 不命名为 Open/Close，实际安装方向可能不同；也不据此断言发声功能。
四个 Timer 均为 Toggle：首次开启，再次按相同按钮取消，两次发送完全相同的 HEX。
由于没有可靠 State Query，页面不按点击次数推断或显示设备真实定时状态。不同 Timer 间的切换关系和完整到期行为尚未在本轮验证。

## V4 手动验收

1. 在原 HTTPS 页面连接 WZKJ01，确认 Connected。
2. 分别单击 Action A / B，观察机械臂向相反方向旋转并核对日志。
3. 单击 30min，观察青色 LED；再次点击同一按钮，观察取消效果。
4. 分别对 60min、90min、120min 重复上述操作，依次观察绿色、红色、紫色 LED 及取消效果。
5. 每次等待写入及设备动作结束，核对操作名称、完整 HEX、Characteristic、时间及 Write Response 或错误。写入期间六个控制按钮应同时禁用。
6. Disconnect 后确认六个控制按钮全部禁用；回归重连和意外断线行为。

本轮不启动服务或操作真实设备。新定时命令在 Android Chrome 上的实际效果、取消行为及定时到期动作需用户手动验收。

## 启动（由用户手动执行）

现有启动方式不变：项目目录执行 `npm run dev`，然后打开
`http://localhost:5173/story-voice-test-audio/ble-test.html`（若 `.env` 设置了 PORT，请替换端口）。
BLE 本身不需要 API Key。页面的 Connect 点击直接触发原生设备选择器。

## Android Chrome 与 HTTPS

手机和电脑同一局域网时，`http://电脑IP:5173` 不属于安全上下文。手机上的 localhost 也不是电脑。
如已有受信任 HTTPS 反向代理，请复用它，并保留 `/story-voice-test-audio/ble-test.html` 路径。

本仓库原 `server.mjs` 为 HTTP；新增可选证书参数只为**直接运行 Vite** 提供 HTTPS，不改变原业务服务器：

```bash
BLE_HTTPS_CERT=/absolute/path/lan-cert.pem \
BLE_HTTPS_KEY=/absolute/path/lan-key.pem \
npm exec vite -- --host 0.0.0.0 --port 5174 --strictPort
```

手机打开 `https://电脑局域网IP:5174/story-voice-test-audio/ble-test.html`。
证书必须包含访问 IP/域名的 SAN，且签发 CA 已被 Android Chrome 信任；可使用已有开发证书或自行通过 mkcert 等工具签发并安装开发 CA。私钥放仓库外，勿提交。
仅绕过自签名证书警告不能作为验收标准；确认页面显示 `Secure Context: Yes` 和 `Web Bluetooth API: Available`。
证书参数需同时提供，直接通过命令行环境变量传入，不依赖 `.env` 自动加载。
纯 Vite 用于此独立 BLE 页，不提供原 Test Audio 的完整业务后端。

## V2 手动验收

1. 打开 `/story-voice-test-audio/ble-test.html`，点击 Connect 连接 WZKJ01。
2. Connected 后点击 `30min Toggle`，检查设备 LED 是否变青色；等待写入结束，检查成功日志中的 HEX 和 UUID。
3. 再点击 `30min Toggle`，检查青色 LED 是否熄灭，并检查两次 BLE Write Response 完成日志。
4. 点击 Disconnect，确认发送按钮禁用；意外断线后同样应禁用。
5. 写入期间按钮禁用，失败时应显示错误并记录失败日志，不自动补发。设备状态始终由人工观察 LED 确认。

V1 连接与 V2 Web Bluetooth 写入、LED 状态变化已由用户实物验证。

## V1 连接回归验收

1. Android Chrome 打开上述受信任 HTTPS 页面，确认环境检查通过；打开系统蓝牙，并允许 Chrome 所需的蓝牙/附近设备权限。
2. WZKJ01 上电且可发现；先断开 nRF Connect 或其他客户端占用的连接。
3. 点击 Connect：应出现原生设备选择器，只筛选 WZKJ01。先取消一次，检查 Disconnected 和明确取消提示；再次点击应可重试。
4. 选择 WZKJ01：状态由 Selecting → Connecting → Connected，显示设备名称和浏览器 Device ID，并记录事件。此 ID 不是 MAC 地址。
5. 点击 Disconnect：显示 Disconnected，日志标记主动断开，没有意外断开错误。再次 Connect 可重连。
6. 已连接时关闭设备电源或使设备离开范围：浏览器报告断线后 UI 应显示 Disconnected 和意外断线提示。通知延迟取决于系统 BLE 超时。
7. 拒绝权限或让设备在连接期间不可用，确认错误可见且没有未处理 Promise 异常。HTTP 局域网页面应禁用 Connect 并提示 HTTPS；不支持 API 的浏览器应给出明确提示。
8. 在原入口手动回归 Test Audio；此页不导入或更改 Story、Pipecat、STT、TTS 链路。

连接期间按钮禁用以避免重复请求；V5 仅在初始化时尝试自动连接，断线后不自动重连。离开页面或 HMR 卸载时移除监听并尽力断开，迟到的连接成功也会断开。日志仅保留内存中最近 100 条。

## 离线检查

```bash
node --experimental-strip-types --test test/ble-connection.test.mjs
```

测试替身仅存在于测试文件，覆盖成功、取消、权限失败、GATT 失败、意外断线、重连、环境限制、卸载竞态和断开异常；不能代替 Android Chrome / WZKJ01 实测。

API 行为参考：[Chrome Web Bluetooth 文档](https://developer.chrome.com/docs/capabilities/bluetooth)。

V2 离线测试另覆盖精确字节及 UUID、重复点击、发现/写入失败、断线重连竞态、迟到响应与卸载清理。
API 参考：[writeValueWithResponse](https://developer.mozilla.org/en-US/docs/Web/API/BluetoothRemoteGATTCharacteristic/writeValueWithResponse)。

V4 自动化测试补充六条命令的精确字节、相同命令重复发送、跨按钮写入锁、断开保护、错误日志与失败后的锁释放；测试替身仅用于离线测试。

## Pipecat 语音控制接入

新增 Activity 模块复用本页 BleConnection 和六条命令，独立测试页行为保持不变。语音验收在 V4 内的 WZKJ01 活动面板手动连接，不能复用另一个标签页的连接。架构、启动与验收见 [BLE Voice Control](./ble-voice-control.md)。本轮只编写代码和测试，未执行验证。
