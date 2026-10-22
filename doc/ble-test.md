# Web Bluetooth V2 — WZKJ01 / 30min Toggle

独立 React 页面：`/story-voice-test-audio/ble-test.html`，遵循项目现有多 HTML 入口方式。
复用 V1 连接/断开 GATT，增加固定的 30min Toggle 写入，不订阅 Notify，不调用后端或模型 API。
名称精确过滤 `WZKJ01`；在 `optionalServices` 声明 `fa879af4-d601-420c-b2b4-07ffb528dde3`。
点击 `30min Toggle` 时，复用当前 GATT 连接获取上述 Service 和 Write Characteristic
`b02eaeaa-f6bc-4a7e-bc94-f7b7fc8ded0b`，将 `fe01000632010100ff08` 转换为 10 字节 Uint8Array，调用 `writeValueWithResponse()`。
仅 Connected 且没有待完成写入时可发送；服务发现到响应完成期间均防止重复点击，不排队、不自动重试。
成功/失败日志包含时间、HEX、Service UUID、Characteristic UUID 和失败时的错误信息。
Write Response 仅代表 GATT 写入完成，不确认设备定时状态；页面不按点击次数推断开启/关闭。写入失败也可能已影响设备，请观察 LED 后再决定是否重试。
Notify UUID 本阶段不使用。

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

V1 已由用户验证真实设备连接；V2 的 LED 行为尚需真实设备手动验证。

## V1 连接回归验收

1. Android Chrome 打开上述受信任 HTTPS 页面，确认环境检查通过；打开系统蓝牙，并允许 Chrome 所需的蓝牙/附近设备权限。
2. WZKJ01 上电且可发现；先断开 nRF Connect 或其他客户端占用的连接。
3. 点击 Connect：应出现原生设备选择器，只筛选 WZKJ01。先取消一次，检查 Disconnected 和明确取消提示；再次点击应可重试。
4. 选择 WZKJ01：状态由 Selecting → Connecting → Connected，显示设备名称和浏览器 Device ID，并记录事件。此 ID 不是 MAC 地址。
5. 点击 Disconnect：显示 Disconnected，日志标记主动断开，没有意外断开错误。再次 Connect 可重连。
6. 已连接时关闭设备电源或使设备离开范围：浏览器报告断线后 UI 应显示 Disconnected 和意外断线提示。通知延迟取决于系统 BLE 超时。
7. 拒绝权限或让设备在连接期间不可用，确认错误可见且没有未处理 Promise 异常。HTTP 局域网页面应禁用 Connect 并提示 HTTPS；不支持 API 的浏览器应给出明确提示。
8. 在原入口手动回归 Test Audio；此页不导入或更改 Story、Pipecat、STT、TTS 链路。

连接期间按钮禁用以避免重复请求；不会自动连接或重连。离开页面或 HMR 卸载时移除监听并尽力断开，迟到的连接成功也会断开。日志仅保留内存中最近 100 条。

## 离线检查

```bash
node --experimental-strip-types --test test/ble-connection.test.mjs
```

测试替身仅存在于测试文件，覆盖成功、取消、权限失败、GATT 失败、意外断线、重连、环境限制、卸载竞态和断开异常；不能代替 Android Chrome / WZKJ01 实测。

API 行为参考：[Chrome Web Bluetooth 文档](https://developer.chrome.com/docs/capabilities/bluetooth)。

V2 离线测试另覆盖精确字节及 UUID、重复点击、发现/写入失败、断线重连竞态、迟到响应与卸载清理。
API 参考：[writeValueWithResponse](https://developer.mozilla.org/en-US/docs/Web/API/BluetoothRemoteGATTCharacteristic/writeValueWithResponse)。
