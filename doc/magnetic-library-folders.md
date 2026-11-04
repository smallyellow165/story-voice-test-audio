# Magnetic Analysis Inspector 与服务器图片子文件夹

Analysis / Visible 3D 的 Trace / Raw 已移至 Inspector / Tiles Catalog 顶部同行的右侧。移除原 Trace 标题空行、空图片集合表格和重复说明；两种 Analysis 页面使用统一的紧凑控件。首次默认服务器图片；2D 的显式 URL 和已保存来源偏好仍有效，模型选择规则不变。

服务器图片区域使用剩余右栏高度，列表内部滚动。选择区域最多四行，过窄时在其自身区域内滚动；长文件名截断，完整相对路径保留在提示、Checkbox 名称和已选图片元数据中。移动端 Inspector 使用明确的视口高度，避免列表退回最小高度后下方留白。

## 图片放置位置

当前服务默认根目录（保留项目原来的 `maganetic` 拼写）：

```
/home/umi/min-wrk/projects/story-voice-lab/story-voice-test-audio/public/test-images/maganetic/
  root-photo.png
  car/
    front.jpg
    side.jpg
    details/
      rear.jpg
  castle/
    front.jpg
    overview.png
  bridge/
    photo1.webp
```

文件夹由用户直接在服务器上建立、移动或改名。UI 不提供文件管理操作。添加后点击「刷新」；点击文件夹进入，用「图库 / car / details」面包屑返回。搜索始终匹配整个素材库的文件名和完整相对路径，不限于当前文件夹。清空搜索后返回原浏览位置。

选择跨文件夹保留，可混合 1–4 张不同图片。刷新、浏览文件夹、搜索均不改变当前图片集合。已选图片来自不可变 Source/Asset 快照；原文件改名、删除或替换后，原 Analysis 仍可读取原字节。若要采用修改后的文件，需主动移除原选择并重新选择。

## 身份与安全

- `GET library` 仍返回 `images: [{name,mimeType}]`，新增 `folders: string[]`。`name` 现在可为 `car/front.jpg` 等规范化相对路径；根目录 `front.jpg` 格式不变。
- `POST library-image {name}` 沿用原接口。缩略图缓存、选择判断、读图请求使用完整相对路径；basename 仅用于当前文件夹中的短显示。
- Analysis 继续使用原内容 Hash 与 Source Set ID/Hash。选入图片的 `name` 元数据保存相对路径；同内容重复图片继续沿用原去重规则，不因文件路径不同复制内容存储。
- 文件夹不是 Creation ID、Project ID 或 Lineage。浏览素材不会加载旧 Analysis、Spatial Plan、Reconstruction 或其他工作区 Draft。
- 仅接受非绝对、非空、无 `.` / `..` / 空段 / 反斜线 / 控制字符的相对路径。JSON 路径不做 URL 解码，不接受客户端指定根目录。隐藏目录/文件不发现。
- 当前 Linux 服务使用目录文件描述符逐级打开，每级目录和最终图片均设置 `O_NOFOLLOW`；根目录祖先、子目录和图片符号链接均不允许，目录替换也不能把已打开的父目录重定向到外部。
- 保留 JPEG/PNG/WebP 类型、原有图片内容验证、6 MiB 文件与有界读取、浏览器像素与识别视图尺寸限制。相对路径总长度沿用现有图片集合名称的 255 字符限制；不修改历史数据结构或迁移记录。

## 验证与验收

```
npm run test:magnetic-library
npm run test:magnetic-library:browser
npm run test:magnetic-workspace:browser
node --experimental-strip-types --test test/magnetic*.test.mjs
npm run test:magnetic-3d
npm run build
```

图库浏览器测试使用临时目录和真实本地图片副本，无生产写入、无模型调用。覆盖多层/空文件夹、同名文件、路径搜索、缩略图、刷新与改名、跨文件夹选择/取消、四张上限、离线 Analysis、历史快照、Create 隔离与 2D 默认页。另行运行完整 Create/Edit 回归。

实际浏览器测量（列表内部滚动；Inspector 均无横向溢出）：

| 窗口 | 列表可见高度 | 状态 |
| --- | ---: | --- |
| 1550 × 1100 | 765px | 未选择图片 |
| 1100 × 900 | 367px | 已选 4 张 |
| 680 × 900 | 347px | 已选 4 张 |
| 390 × 844 | 291px | 已选 4 张 |

原列表固定最大约 224px。以上为测试窗口实测，实际高度随窗口、选择数量及展开内容调整。

手动验收：从 Gallery Create New 进入 Analysis，确认默认服务器图片、顶部 Trace 同行；进入 car 选择 front，再进入 castle 选择同名 front，检查两者独立。搜索 `car/details`，补选其他图片到四张，确认第五张禁选；取消一张后可再选。刷新或切换文件夹后检查已选区不变。缩小窗口检查列表内部滚动及 Trace 对齐。最后切换 Gallery Edit A/B，确认仍恢复各自固定基线和私有 Draft。

本轮不修改 Prompt、模型选择、Geometry、Solver、Assembly Editor、Gallery 发布/工作区数据模型或 Tutorial。
