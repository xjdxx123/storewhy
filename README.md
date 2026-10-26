# StoreWhy

**An evidence-backed growth investigation agent.** StoreWhy explains changes in acquisition, purchasing and observed channel returns, then carries the investigation through follow-up questions.

StoreWhy 帮助运营人员检查“为什么费用增加，用户收入却没有同步增长”。它支持指标查询、时期比较、渠道贡献、用户批次、人群比较与解释检查。Investigator 负责调查，Reviewer 独立检查证据并要求补查。数字、SQL、统计口径和查询 ID 可以追溯。模型选择调查路径和经过验证的观测证据，数字及比较语句由后端据此生成。

当前仓库交付 TypeScript 后端与共享 contracts；React UI 由队友负责。见 [前端接入](docs/frontend-integration.md)、[架构](docs/architecture.md)、[实施计划](docs/plans/2026-10-23-growth-investigator-mvp.md)。

## 本地快速启动

需要 Node.js 22+。以下命令在仓库根目录执行：

```sh
npm ci
cp .env.example .env.local
npm run dev
```

服务默认监听 `http://127.0.0.1:3100`。默认 `fixture` 模式使用仓库内自制样例，查询与 `/api/v1/demo` 无需凭据。**自由提问仍需要可用的 Nightshift Runtime**；示例回放明确标注没有调用在线 Agent。

```sh
curl http://127.0.0.1:3100/healthz
curl http://127.0.0.1:3100/api/v1/catalog
curl http://127.0.0.1:3100/api/v1/demo
```

编译与运行：`npm run build`、`npm start`。通过 `PORT`、`HOST`、`CORS_ORIGINS` 配置端口与 React 开发地址，默认允许 localhost/127.0.0.1 的 5173 端口。

## Live 数据与模型

1. 按 Hackathon 指南启动 Zetaris 本地平台和 Nightshift。在 Nightshift Providers 内连接 NVIDIA，模型 key 保存在 Nightshift 中。
2. 在私有 `.env.local` 中填入 `ZETARIS_API_KEY`、`METERLESS_RUNTIME_TOKEN`、实际的 `METERLESS_MODEL` 与服务地址。不要提交此文件。模型必须能从 Runtime 的 `/models` 返回；已验证模型为 `nvidia/nemotron-3-ultra-550b-a55b`。
3. 为独立数据服务生成至少 20 位、只含字母/数字/下划线/连字符的 `STOREWHY_DB_PASSWORD` 和 `STOREWHY_READER_PASSWORD`，例如 `openssl rand -hex 24`。每个变量分别生成。
4. 确认 `ZETARIS_DOCKER_NETWORK` 与 Zetaris driver 所在网络一致，默认 `zetaris_default`，再执行：

```sh
npm run data:prepare
docker compose --env-file .env.local -f infra/compose.yaml up -d
npm run data:load
npm run data:register
npm run dev:live
```

数据服务独立于 Zetaris 内部数据库，主机端口默认 55432。导入在事务内执行，检测到不完整旧数据时拒绝覆盖。Zetaris 使用只读 PostgreSQL 账号；产品的在线统计全部经 Zetaris，直接数据库访问仅用于导入。

`GET /api/v1/integrations` 返回数据与模型连接状态，区分 online、unauthorized、offline 和模型不存在。状态探测不代表所有产品查询已通过；真实验证使用下面的命令。

## 数据、口径与边界

公开教学案例 **Procrastinate Pro+** 的三个文件来自 `https://code.s3.yandex.net/datasets/`：

| 文件                  |    行数 | 用途                           |
| --------------------- | ------: | ------------------------------ |
| visits_info_short.csv | 309,901 | 访问与首次观测渠道、设备、国家 |
| orders_info_short.csv |  40,212 | 购买事件与收入                 |
| costs_info_short.csv  |   1,800 | 渠道 × 日期费用                |

`data:prepare` 下载并核对固定 SHA-256，生成 [manifest](data/manifests/procrastinate.json)。原始文件仅缓存在被忽略的 `data/raw/`；未确认原始数据再分发许可，不打包原始 CSV。仓库内 fixture 是本项目自制，数值不代表真实商家。

- 数据为 2019-05-01 至 2019-10-31 的快照；获客与费用到 10 月 27 日，后续观察到 10 月 31 日。金额币种与时区未注明，沿用原始时间与样例金额单位。
- 使用首次观测访问归属，不宣称广告触点或购买瞬间设备。多来源同时出现时，依次按时间、渠道、设备、国家、导入行 ID 稳定排序。
- `calendar` 为自然时期；`cohort` 为获客批次首访后 7/14 天。默认比较六月与七月、付费渠道、14 天。未成熟获客日期与匹配费用一起裁剪，并披露排除人数。
- 金额使用数据库 Decimal 汇总，再舍入到两位；保留源费用小数精度，避免逐行舍入累积误差。购买事件行数与不同购买用户数分别计算。
- 费用只有渠道和日期粒度，设备/国家费用请求会拒绝。`organic` 未提供费用。零分母或缺失费用返回 `null`，不伪装成零。
- 日/周/月趋势使用自然时期，周一为周起点。桶首日可能早于请求起点，但仅统计请求日期内的事件；没有记录的日期不补零。不同时间桶的活跃人数、付费人数不能直接相加。
- 没有曝光、点击、素材、商品、结账步骤、退款、利润或广告因果增量。解释是观测证据支持的诊断，不能证明广告投放因果。

## 验证

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm audit --audit-level=high
npm run test:live
npm run eval:live
```

前五项无需外部服务；Live 的独立参考核算另需要 Python 3 标准库。`test:live` 通过 Zetaris 对齐独立月度基准、渠道合计与窗口边界，`eval:live` 运行真实模型的固定问题、改写、全新保留问题与三组多轮追问。Live 评测调用已配置的模型，会产生供应商用量。脱敏结果保存到 `evidence/`，会话、原始执行状态和 H-MEM 保存在被忽略的 `.state/`。后端为单进程本地 MVP，不适合多实例并发写入。

## Sponsor 与来源

- **Zetaris**：读取登记的三类业务数据与派生用户表，实际执行所有在线分析 SQL。
- **Meterless Nightshift**：OpenAI-compatible Runtime，路由 Investigator 与 Reviewer 模型调用并保留实际 provider/model 与 receipt ID。
- **Meterless H-MEM**：持久化有来源的会话默认窗口、用户纠正与调查摘要；显式替代旧规则并保留 ledger。确定性 hash embedding 只作为参考实现，不宣称中文语义搜索能力。
- **NVIDIA**：通过 Nightshift 提供实际推理模型。

H-MEM 复制自 Meterless 的 Apache-2.0 参考模块，版本与修改见 [UPSTREAM](packages/hmem/UPSTREAM.md)，保留 [LICENSE](packages/hmem/LICENSE)。本项目新增指标编译、数据接入、调查循环、状态/记忆适配、API、客户端与验证。Zetaris/Meterless 文档来源固定版本见 [source_versions](setup/source_versions.json)。

## Evidence-bound charts

后端 API 1.1.0 的回答增加可选 `charts/chartNotes`，支持对比条形、自然时期趋势和首次/后续购买收入构成。每点引用实际 Evidence 单元格；也可调用 `GET /api/v1/evidence/:id/charts` / `client.evidenceCharts(id)`，不会新增模型或 SQL 调用。React 接入见 [图表契约](docs/chart-contract.md)，离线 mock 见 [三类样例](docs/examples/charts.json)。运行 `npm run docs:charts` 重新生成自制样例，Live 验证用 `npm run test:charts -- --agent`（需已启动新版 Live 服务）。

## Grounded answers and followups

API 1.2.0 新增 `answer.conclusion/keyEvidence/followups`：具体结论、可展开的关键证据，以及带完整范围和上下文版本的可执行推荐。`client.followup(action)` 沿用 messages API；过期动作返回 409 STALE_CONTEXT。接入见 [回答契约](docs/answer-contract.md)，离线 payload 见 [Answer mock](docs/examples/answer.json)。`npm run docs:answer` 生成样例，`npm run eval:answers` 在运行中的 Live 服务验证真实模型回答与连续追问。

API 1.3.0 增加 Why 的 `answer.explanations`：用实际证据区分观测支持、观测反驳、数据不足与尚未检查。自然月对比、完整月份请求、默认人群与多轮时期修改有范围保护。`npm run eval:why` 保存扩展 Why 与多轮追问结果；`scripts/verify-why-reference.py` 独立核对全部聚合单元格和成熟度。字段与状态含义见 [回答契约](docs/answer-contract.md)。

## Runtime progress and recovery

API 1.4.0 为 Run 增加可选的 `progress/timing/error/warnings`，SSE 提供真实调查阶段。共享 client 支持 `resume`、事件序号去重和 `waitForRun`；刷新不重新提交，取消等待与取消调查分别处理。模型、数据或后端失联时返回明确错误，不显示旧答案或回退为样例。具体接法见 [前端接入](docs/frontend-integration.md)。

```sh
npm run bench:runtime -- --runs=5 --label=local --output=evidence/runtime-local.json
npm run test:browser           # 自制样例 + 脚本模型，明确标注
npm run test:browser:live      # 真实 Zetaris / Nightshift / NVIDIA
npm run demo:check             # 当前服务的只读 Demo 预检
```

浏览器命令使用本机 Chrome，必要时设置 `STOREWHY_CHROME`。这些 test:browser 命令是独立的 SDK/API 联调工具。实际备用 React 页面见下节；队友页面仍可独立实现。Live 评测与性能测试逐项运行，避免共享本地 Spark driver 上多套测试争用资源；连接状态健康不保证长时间高负载不会耗尽 Docker 内存。本机 Zetaris 的 heap/内存配置见 [本地运行配置](docs/local-runtime-profile.md)。最新前后对照、故障记录和验收边界见 [运行优化验证](docs/runtime-verification.md)。

## 轻量备用 UI

React + TypeScript 单页位于 `apps/fallback-web`，与队友 `apps/web` 分开。后端运行后，在另一 Terminal 执行 `npm run dev:ui`，打开 **http://127.0.0.1:5173/**。支持自由提问、连续追问、真实进度、取消、刷新恢复、图表与逐点 Evidence/SQL。

`npm run build` 同时构建后端与备用 UI；`npm run test:ui` / `npm run test:ui:live` 验证实际 React 页面。启动、代理、样例标识和边界见 [备用 UI](docs/fallback-ui.md)。
