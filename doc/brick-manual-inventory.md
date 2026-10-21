# DUPLO Catalog / Manual Session Inventory

后续正式游戏接入、最新启动与验收见 [Session Inventory → Brick Building](brick-session-game.md)。
本文其余内容记录 Catalog 初版；“不接 V4 / Generator”等说明仅适用于该初版。

独立页面：`http://localhost:5173/story-voice-test-audio/brick-inventory.html`。
现有 `/brick-test` 标题栏新增“手动库存 Catalog”链接，便于进入。
本阶段不修改 V4、Pipecat、Brick Building Runtime 或 V3 Generator。

## 数据调查与边界

2026-10-21 通过现有 My-Good-GYM MySQL 配置做只读查询确认：数据库是
`vooks_video_archive`，有 12 张 `rb_` 表。未执行 CLI、DDL、数据写入、API 图片下载或测试。

Catalog 使用：

| 表 | 字段 / 用途 |
| --- | --- |
| `rb_parts` | `part_num`, `name`, `part_cat_id`：编号、名称、分类 |
| `rb_part_categories` | `id`, `name`：分类筛选 |
| `rb_colors` | `id`, `name`, `rgb`, `is_trans`：Rebrickable 颜色 |
| `rb_elements` | `part_num`, `color_id`：已知型号颜色组合 |
| `rb_inventory_parts` | `part_num`, `color_id`：补充套装清单中的组合，去重，不把套装数量当作家庭库存 |

`rb_parts`、`rb_elements`、`rb_inventory_parts` 没有图片字段；`rb_sets.img_url`
是套装图片，未用于零件卡片。调查时 `rb_colors` 有 275 行，`rb_elements` 有
108,728 行，`rb_inventory_parts` 有 1,461,120 行。

分类 4 是 `Duplo, Quatro and Primo`；分类 57 包含多系列人物。直接只按分类筛选会混入
其他系列，因此本页限定 `LOWER(name) LIKE 'duplo %'`，调查时得到 5,804 个型号。
这是一条明确的 Catalog 选择规则，不声称覆盖名称没有 DUPLO 前缀的全部兼容零件。
不限制在 V3 支持的三种积木；可用颜色限定为数据库中已出现的型号颜色组合。

## 实现路径

本次文件清单：

| 项目 | 文件 | 用途 |
| --- | --- | --- |
| Test Audio | `brick-inventory.html`、`src/brick-inventory/main.tsx` | 独立页面入口 |
| Test Audio | `src/brick-inventory/InventoryPage.tsx`、`inventory.css` | Catalog、图片状态、响应式库存编辑 |
| Test Audio | `src/brick-inventory/inventory.ts`、`storage.ts` | 统一库存契约、数量操作、浏览器保存 |
| Test Audio | `server/brick-catalog.mjs`、`server.mjs` | 现有服务中的 Catalog 代理 |
| Test Audio | `vite.config.ts`、`src/brick-test/BrickTestPage.tsx` | 页面构建入口、导航链接 |
| Test Audio | `.env.example`、`package.json` | 代理配置说明、离线测试入口 |
| Test Audio | `test/brick-inventory.test.mjs`、本文件 | 测试用例与运行验收说明 |
| My-Good-GYM | `api/rebrickable_catalog.py`、`rebrickable_catalog_store.py`、`rebrickable_media.py` | 只读数据库路由、缓存、官方图片元数据 |
| My-Good-GYM | `api/__init__.py`、`.env.example` | 注册路由、开关与 API Key 配置说明 |
| My-Good-GYM | `tests/test_rebrickable_catalog.py` | 离线数据库/API 边界与缓存测试 |
| V4 | 无改动 | 本阶段不接游戏 Runtime |

```text
Test Audio React 页面
  → /api/brick-catalog/*（现有 server.mjs，同源 GET 代理）
  → My-Good-GYM /rebrickable-catalog/*（现有 Application Server）
  → api/video_seeker_db.get_connection() → 已有 rb_ 表
  → Rebrickable API（仅图片 URL 元数据，按需）
```

Application Server 新增 `api/rebrickable_catalog.py`、`rebrickable_catalog_store.py`、
`rebrickable_media.py` 并注册路由。复用原有连接配置、PyMySQL、FastAPI、httpx；无新依赖、
服务、表、数据库访问客户端或游戏框架。API 仅允许 loopback 服务端请求，前端由 Test Audio
代理，可通过局域网在手机上打开同一页面。

路由：`filters`、`parts`（search/category/color/page/page_size）、`images`（当前页批量）、
`color-image`（指定型号和颜色）、`selection`（加载库存时恢复名称）。SQL 参数化，分页上限 48；
查询结果使用最多 256 项、约 10 分钟的进程内缓存。原表相关列无索引；初次查询性能需要实际验收，
本次没有自动加索引或改变导入表。

## 官方图片、缓存与错误

- 当前页只发起一次 `/api/v3/lego/parts/?part_nums=...&page_size=...`，取 API 返回的 `part_img_url`。
- 默认图片明确标注“型号示意图”，不声称是所选颜色。点击“查看所选颜色图片”才请求
  `/api/v3/lego/parts/{part_num}/colors/{color_id}/`，使用该响应的 `part_img_url`。
- 不构造 CDN 路径、不借用套装图、不显示伪模型。不自动重试。
- `REBRICKABLE_API_KEY` 只存在于 Application Server，以 Authorization header 发送。
- URL 元数据默认保存在 My-Good-GYM `.cache/rebrickable/`：成功 30 天，无图片 / 404 1 天；
  API 网络、鉴权或限流失败不写成“没有图片”。磁盘写入失败也会提示。
- 图片本体使用官方 HTTPS URL 和浏览器 HTTP 缓存，不由服务端下载或镜像。
- 单进程请求串行且间隔至少 1.1 秒；429 遵循 Retry-After（60–3600 秒冷却），不立即重试。
  401/403 暂停 60 秒，网络错误暂停 30 秒。此限制不是跨多个 worker 的分布式限流器，
  本地第一版用单 worker，其他使用同一 API Key 的程序仍可能共同触发限流。
- UI 区分：没有匹配记录、没有颜色记录、未配置图片 API、鉴权失败、限流、无图片、
  图片元数据失败、图片加载失败。没有 API Key 时 Catalog 与手动库存仍可使用，但没有官方图片。
- 接受官方 `rebrickable.com` / `rebrickable.net` 域及子域的 HTTPS 图片 URL。
  如果官方将来返回其他图片域，会明确提示未支持，而不是替换图片。

官方资料：[API 入口](https://rebrickable.com/api/)、
[V3 文档](https://rebrickable.com/api/v3/docs/)。官方要求 API Key，说明平均约一次/秒，
全量数据应使用 CSV。此次只读取文档，未调用带凭据的 Rebrickable API，故当前账号权限、
实际图片覆盖率尚未验证。条款页面未能读取，未确认另行镜像、再分发或商用授权；实现没有
批量抓图或镜像。页面保留 Rebrickable 来源链接。

## 库存数据与保存

`src/brick-inventory/inventory.ts` 是与 UI/游戏无关的唯一库存契约和数量操作入口：

```json
{
  "schema_version": 1,
  "id": "00000000-0000-4000-8000-000000000001",
  "name": "今天的积木",
  "updated_at": "2026-10-21T00:00:00Z",
  "items": [
    { "part_num": "3437", "color_id": 4, "quantity": 2 },
    { "part_num": "3437", "color_id": 1, "quantity": 1 }
  ]
}
```

同一 `part_num + color_id` 累加，不同颜色分行。每行 1–999 块、最多 500 行；减到 0 或删除即移除。
数量、重复行、格式在保存前校验；列表总数按 quantity 求和。上述颜色 ID 为 Rebrickable 域。

显式“保存库存”写入当前 origin 的 localStorage：`duplo.session-inventories.v1`。
可命名多份 Session、重新加载和继续编辑；覆盖当前 Session 保留其 ID。新建库存分配新 ID。
切换未保存内容有确认提示，刷新/关闭页面有 beforeunload 提示（浏览器可能限制该提示）。
损坏数据、禁用存储、配额不足均显示失败，不先清除原数据。JSON 导出用于备份或后续集成；
本版未增加 JSON 导入。多标签同时编辑同一 Session 为最后保存覆盖；尚无冲突合并。
隐私模式、清理站点数据、换浏览器/设备/端口后不能依赖同一份 localStorage。
库存不是 Owned Inventory，没有服务器或跨设备同步。

V3 当前使用 `{part, color, quantity}`，其中 color 是 LDraw 颜色。不能把 Rebrickable
`color_id` 直接填进去。本阶段复用“型号 / 颜色 / 数量”语义，但保留明确的 Rebrickable 契约；
不增加旧格式兼容、双读取或映射。未来 Manual、Upload、Camera 应共同产出此 `items` 格式，
接 Generator/Viewer 时再另行解决映射与支持范围。

## 用户启动

1. 在 My-Good-GYM `.env.local` 中保留已有 `VIDEO_SEEKER_DB_*` 配置，确认
   `VIDEO_SEEKER_DB_NAME=vooks_video_archive`。添加 `REBRICKABLE_CATALOG_LOCAL=1`，
   配置个人 `REBRICKABLE_API_KEY`（从 Rebrickable 账户设置获取，不提交到 Git）。
2. 使用现有 Application Server 环境和启动方式；如果没有在运行，可在该项目执行：

   ```bash
   python -m uvicorn server:app --host 127.0.0.1 --port 8001
   ```

3. Test Audio `.env` 可设置 `APPLICATION_SERVER_URL=http://127.0.0.1:8001`（默认值），
   然后在该项目执行：

   ```bash
   npm run dev
   ```

4. 打开 `http://localhost:5173/story-voice-test-audio/brick-inventory.html`。
   手机打开 `http://电脑局域网IP:5173/story-voice-test-audio/brick-inventory.html`，
   Test Audio 需监听 `0.0.0.0`（现有默认），允许该端口；Application Server 仍只监听 loopback。
   若配置其他 PORT，替换地址端口。

此页需要 `server.mjs` 的 API 代理；`npm run dev:brick` 和纯 `vite preview` 不提供 Catalog API。
不需要构建共享游戏模块，也不需要启动 V4、Pipecat 或 Gemini。未修改现有 V4 的任何 UI/游戏入口。

## 验收与测试（交给用户执行）

1. 打开 Catalog：检查图片、编号、名称；搜索 `3437`、`Animal`，切换分类/颜色、翻页；
   搜索不存在的文字应显示“没有匹配记录”。
2. 同型号同颜色加入两次，数量累加；换颜色加入，出现另一行。测试增减、删除和总数。
3. 点击“查看所选颜色图片”，确认颜色图与型号示意图标签不同；API 无图/失败时文字准确，库存仍可编辑。
4. 保存两份不同名字库存，刷新页面后分别加载、修改并保存；导出 JSON 检查 canonical 字段。
5. 手机竖屏测试搜索、图片、颜色选择、数量和保存。顶部“今天的库存”链接可直接跳至窄屏下方库存区。
6. 临时移除 API Key 并重启 Application Server，使用未缓存型号验证明确提示；已缓存图片仍可复用。
   断开 Application Server 应显示连接失败，不能显示为“无匹配记录”。

编写了离线测试但未执行：

```bash
# Test Audio：库存合并、颜色区分、数量边界、持久化与坏数据、代理边界
npm run test:brick-inventory
# Test Audio：现有 TypeScript / Vite 构建验证
npm run build
# My-Good-GYM：参数化查询、已知颜色、缓存、限流、错误区分和本地 API 边界
python -m unittest discover -s tests -p 'test_rebrickable_catalog.py'
```

本轮仅做只读数据调查、代码和测试用例编写；没有运行构建、测试、浏览器验收、服务或真实 LLM。
实际 API 响应、图片覆盖率、SQL 延迟、桌面/手机视觉效果及跨进程联调尚待上述验收。
