# 轻量备用 UI

独立应用在 `apps/fallback-web`，使用 React、TypeScript、Vite 和现有 `@storewhy/contracts/client`。不占用队友的 `apps/web`；两套 UI 可共存、分别启动。

## 启动

在仓库根目录执行 `npm install`。Node.js 使用 22.12 或更新版本。

推荐录屏启动：完成 [新电脑首次配置](recording.md) 后执行 `npm run demo`，同时启动 Live 后端和生产构建的备用 UI；Ctrl+C 同时关闭。

开发时也可使用两个 Terminal 分别运行：

```sh
npm run dev:live
```

```sh
npm run dev:ui
```

打开 **http://127.0.0.1:5173/**。后端为 3100；Vite 将 `/api` 与 `/healthz` 代理到本机后端，含 SSE。所有凭证继续放在根目录私有 `.env.local`，浏览器不需要 API key。

若后端使用其他地址，在启动 UI 前设置 `STOREWHY_API_TARGET`，例如：

```sh
STOREWHY_API_TARGET=http://127.0.0.1:3120 npm run dev:ui
```

此变量仅供 Vite 配置读取，不是浏览器里的密钥配置。只监听本机，未部署或对外发布。

构建和本机预览：

```sh
npm run build
npm run preview:ui
```

预览也需要已运行的后端。静态构建位于 `apps/fallback-web/dist`，不提交；若以后部署需另配 API 反向代理。根目录的 lint/typecheck/build 已纳入备用 UI，原后端单独构建可用 `npm run build:server`。

## 支持的交互

- 自由提问与推荐追问；快捷切换 FaceBoom、全部渠道、7/14 天。其他日期或筛选可以直接在问题中说明。
- 始终显示本轮实际时期、窗口、人群、渠道、设备、国家和日期边界；结果标明数据版本与来源。
- 当前结论、关键证据、解释状态、局限与推荐追问。点击依据可查看数值、指标定义、实际条件、SQL、queryId 和成熟度。
- 对比条形、趋势折线和首次/后续收入堆叠图；不把 null 补零，折线在 null 或缺失的日/周/月处断开，按时间排序，负值保留符号。数据表可逐点查看来源，所有点均保留，不截掉尾部。
- 真实进度、取消与错误状态；刷新恢复同一个调查，不重新提交。SSE 暂时不可用时每两秒读取原 Run。旧 Run 的异步请求不会覆盖新 Run。
- “记住默认窗口”在当前会话保存明确偏好；“按默认条件新分析”恢复该会话偏好并清除临时筛选。“新会话”创建独立会话，不继承其他会话的记忆。
- 消息响应不可确认时禁用再次提交，提示先恢复；恢复只读状态，不自动重发 POST。取消/失败/unsupported 不保留上一次报告。
- “查看自制样例”是明确选择的只读回放，不调用在线 Agent；返回调查后才能继续提交问题。Live 失败不会自动切换样例。默认 fixture 后端也不会自动模拟自然语言模型。

会话 ID 存在此 UI origin 的 localStorage；端口、浏览器或设备变更不会自动同步。暂无会话历史列表、图像导出或完整筛选表单，页面聚焦最小调查流程。

## 验证

```sh
npm run test:ui       # 实际 React 页面 + 自制数据/脚本模型
npm run test:ui:live  # 实际 React 页面 + Zetaris/Nightshift/NVIDIA
```

使用本机 Chrome；可通过 `STOREWHY_CHROME` 指定可执行文件。测试启动隔离后端和 Vite，不改动 3100 会话；每次有新的运行/证据 ID。Live 命令会调用已配置模型，须有本地数据和服务。

自动浏览器检查覆盖主 Why 中途刷新、推荐执行、渠道与窗口继承、记忆恢复、取消、数据不足、SQL/来源展开和 390px 布局。fixture 额外注入 SSE 不传事件、模型离线和不可解析的消息响应，并用明确自制的渲染输入检查 null/负数与堆叠；渲染边界检查不计作真实来源核算。首版渲染测试曾只提供两个点却断言三点，开发失败记录保留，修正测试样例后重新验证。Review 还复现并修复了折线跨缺失时间桶连线的问题，补充日、跨年周、跨年月的实际 SVG 断线断言。

真实结果分别写入 `evidence/fallback-ui-fixture.json`、`evidence/fallback-ui-live.json`，截图同前缀。参考实现文档：[React root](https://react.dev/reference/react-dom/client/createRoot)、[Vite](https://vite.dev/guide/)。
