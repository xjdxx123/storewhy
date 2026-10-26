# Runtime 优化与联调验证

验证日期：2026-10-25（America/Toronto；部分记录为 10 月 26 日 UTC）。接口版本 1.4.0。React UI 由队友负责，本次完成后端、共享 client、独立浏览器联调与接入材料。

## 可交付行为

- Run/SSE 提供真实阶段、明确终态、可读错误与可选计时。没有进度百分比，也不把 Reviewer 的补查建议说成已执行查询。
- 页面刷新通过 conversationId 恢复同一个 Run；SSE 以 seq 去重并正确处理 Last-Event-ID。断开 SSE 不取消调查，可使用状态轮询继续读取。
- 取消会停止本轮等待与后续步骤；传输层传递 AbortSignal，上游是否终止已经开始的计算由上游决定；超时、服务离线、授权失败和服务重启有明确错误，不使用旧 Answer 或 fixture 代替失败。可选记忆保存失败作为 warning，不抹去已完成的有效分析。
- 缩短模型重复输入，保留实际分析范围、数据行、成熟度、observations 与 Why Reviewer。全部候选引用校验后才生成事实；内部候选至多 12 个，最终最多 6 条 findings / 3 条关键证据。
- 两个独立时期的 SQL 可并行执行，同一后端进程跨调查共享两条 SQL 的上限，排队与执行合计受九十秒 deadline 约束，排队取消不发送请求。预先验证全部时期，结果按请求顺序合并，一侧失败会中止另一侧。没有跨请求结果缓存。首查分组规划只允许有效维度，不改变用户的分析条件。

字段、SDK 用法和错误处理见 [前端接入](frontend-integration.md)。

## 第一轮核心优化对照（平台 OOM 前）

固定同一主 Why、数据版本、配置模型与分析条件；前后各五个新会话，基准执行期间没有其他 Live 评测。每轮仍执行 Why Reviewer，结论包含实际查到的 TipTop 变化，事实均有 Evidence 绑定。数据源为 Zetaris，模型经 Nightshift/NVIDIA。

| 指标                       |  修改前 | 修改后 |
| -------------------------- | ------: | -----: |
| 中位总耗时                 |  38.0 s | 35.7 s |
| 本组最长耗时               |  88.9 s | 52.2 s |
| 首个 SSE 事件              | 5–12 ms | 3–9 ms |
| 模型调用，五轮合计         |      34 |     25 |
| JSON 修复，五轮合计        |       9 |      0 |
| 每轮实际 SQL               |       4 |      4 |
| 每轮业务消息输入字符中位数 |  55,389 | 41,430 |

中位耗时减少约 6.2%，业务消息输入字符减少约 25.2%；该对照不含生成的 schema 与传输序列化，不是 token 或费用估算。样本量小、服务延迟有波动，不能据此保证响应时间或稳定的提速比例。SQL 条数没有减少，也没有跳过 Why 审查来换取速度。并行 SQL 的单条耗时会重叠，不能简单相加作为端到端等待。

来源：[修改前五轮](../evidence/runtime-before.json)、[首次优化五轮](../evidence/runtime-before-json-mode.json)、[首次口径核对与汇总](../evidence/runtime-before-json-mode-comparison.json)。`npm run bench:runtime -- --runs=5 --label=local --output=evidence/runtime-local.json` 可在本机重新采样。

## 开发中发现的问题与处理

- 原候选上限为 6，模型多次选择 8 条真实观测，触发 `too_big` 和完整修复。将内部有证据的候选有界增加到 12，明确 prompt 范围；伪造 ID 仍拒绝，展示条数仍有界。
- 第一版输入压缩后，多轮主结论退回整体金额；该版本未验收。恢复必要的 focus，并让无具体分组的费用/收入首句优先展示实际查询的相关渠道；保留比例、首次/后续构成与前提纠正的优先级。失败和中间版本保存在 runtime-intermediate、runtime-diagnostic、runtime-before-planner、runtime-before-parallel 中。
- SSE 恢复时固定 query.after 曾盖过浏览器更新后的 Last-Event-ID；改为取两者较大值。超前 cursor 明确拒绝；SDK 忽略重复和取消订阅后的事件，永久关闭连接不冒充重连。
- 模型超时不再重复完整等待一次；仅网络错误/5xx 有一次传输重试，JSON 校验仍只允许一次修复。失败调用也记录 trace 与耗时。
- 先做过原生 JSON object 能力探测；旧回归随后复现多 JSON 对象导致的格式失败，同题探测中普通格式一轮通过、一轮失败，JSON object 三轮均通过。当前路由现请求 JSON object，trace 记录 responseFormat；这不是 schema 保证，Zod、事实 ID 与 Reviewer 校验均保留，多对象不能任意选择一个当作有效答案。[原探测](../evidence/output-format-probe.json)、[普通格式诊断](../evidence/runtime-intent-diagnostic.json)、[JSON object 同题诊断](../evidence/runtime-json-mode-diagnostic.json)。

- 逐题审阅还发现 Reviewer 沿用原问题的 14 天，错误否定已改为 7 天的追问；仅强调当前 scope 优先仍不足；最终按已确认窗口生成模型侧的有效目标，Context 中保留原始历史。保留日期与显式双窗口问题，不将不支持的比较缩窄成单窗口。修复前的完整 16 轮保存在 runtime-before-scope-fix，静态 prompt 对照在 runtime-scope-prompt-comparison。两轮真实追问已从错误拒绝恢复为按七天完成，原始目标未改写；见 [前后 Reviewer 记录](../evidence/runtime-scope-verification.json)。人数请求另有确定性保护，避免模型漏掉显式要求的 users 指标。明确要求查询/汇总/分别多少的数值请求保持 query，避免被模型误判为 Why 后进行无必要的解释审查；明确因果/解释要求不降为普通查询。

## 故障与恢复覆盖

150 项本地测试通过，包含真实调用边界的故障注入；这些故障记录不能冒称外部供应商发生了真实故障。[测试报告](../evidence/runtime-unit-report.json)。

| 路径         | 验证内容                                                            |
| ------------ | ------------------------------------------------------------------- |
| 取消         | 排队/模型/SQL 中取消，不发布迟到的 Answer                           |
| 超时         | 模型超时不自动重复等待；整轮 deadline 返回明确错误                  |
| 数据离线     | 明确 failed、没有伪造 Evidence/fixture/旧 Answer                    |
| 重启         | 未完成 Run 持久化为 SERVER_RESTARTED，可读可重试                    |
| 可选记忆异常 | 有效分析保留，附带 warning                                          |
| 刷新/断线    | 恢复同一 Run、cursor 去重、备用轮询、等待可取消                     |
| 重复消息     | 同会话运行中拒绝；SDK 不自动重发 POST                               |
| 错误响应     | 非 JSON/null/响应体读取失败返回可处理的错误                         |
| SQL 并发队列 | 跨实例最多两条请求，排队取消不发 HTTP；不等同于消除平台长期内存风险 |
| 并行时期     | 请求顺序不受返回顺序影响、无效时期零 SQL、一侧失败中止另一侧        |

实际还发生过一次平台故障：多套评测运行期间，Docker 记录 `zetaris-driver-1` OOM、exit 137 并自动重启。业务调查如实失败。该事件证明内存耗尽，不能单凭时间关系判定某个查询或代码是唯一原因。重启后串行与双并发 `SELECT 1` 均恢复；保留 [事件与恢复探测](../evidence/zetaris-runtime-incident.json)、[中断的 Why 记录](../evidence/runtime-why-development.json)、[中断的旧回归状态](../evidence/runtime-legacy-development.json)，它们不计入完整通过集。之后串行采样也发生过 OOM，第五轮真实失败已保留在 [调优前最终采样](../evidence/runtime-pre-memory-development.json)。限制并发不是累计内存增长的根因证明。后续长套评测逐项执行；长时间测试导致内存继续增长后，在无运行中主服务调查时受控重启 driver，再进行最终验收。两次维护均未更换数据或模型，最终计时仍有平台生命周期混杂，不能作隔离的代码提速结论。长时间负载下仍应关注 Docker 资源，短期通过不代表消除了平台 OOM 风险。

本机配置过程见 [本地运行配置](local-runtime-profile.md)。单独限制 malloc arena 的扩大负载验证仍失败；随后对本数据快照验证 1g heap 与两条 SQL 的运行预算。

## 浏览器契约联调

`npm run test:browser` 为明确标注的自制样例/脚本模型；`npm run test:browser:live` 为真实 Zetaris/Nightshift/NVIDIA。均通过本机 Chrome 与共享 SDK/API 完成。

Live 七步记录：主 Why 中途刷新并恢复 → FaceBoom 追问 → 改七天 → 保存并在新分析恢复有来源的偏好 → 取消执行 → 独立 Reviewer 补查 → 缺少 CTR 数据停止。刷新没有重复创建 Run；展开了实际 SQL/queryId；逐点核对全部非 null 的图表值与来源（实际点数见最新结果）；没有浏览器 console error。最终工具同时断言绘制点数等于全部非 null 点数；旧工具曾仅检查了 60 点中的 44 点，覆盖遗漏保留在 [开发记录](../evidence/browser-partial-render-development.json)。limited 保持有限解释，不被改写为成功的因果结论。

[Live 结果](../evidence/browser-live.json)、[Live 主页面截图](../evidence/browser-live-main.png)、[结束状态截图](../evidence/browser-live.png)、[fixture 结果](../evidence/browser-fixture.json)。工具路径 `tests/browser` 只在测试实例挂载，不是生产页面或队友 React UI，也不对外发布。测试使用隔离状态目录，报告中的 ID 不对应当前 3100 服务；队友运行命令后会得到本机新记录，离线组件开发使用 docs/examples 下的自制 payload。

## 最终回归与交付边界

最终记录汇总见 [机器可读验收](../evidence/runtime-final-acceptance.json)。

| 检查          | 结果与来源                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 本地工程检查  | 150/150 tests（15 个文件），lint、typecheck、build 与 diff whitespace 检查通过                                                                                                             |
| 扩展 Why      | 16/16；14 completed、1 limited、1 unsupported；[真实记录](../evidence/runtime-why-regression.json) 与 [确定性审计](../evidence/runtime-why-regression-audit.json)                          |
| 独立数值      | [Python CSV 核算](../evidence/runtime-why-regression-reference.json) 1,054 项，覆盖 15 种实际规格                                                                                          |
| 旧问题        | 首轮 43/44，一项真实 MODEL_TIMEOUT；修复查询误分类后，16 个受影响独立题与 12 轮追问全部通过；[组合覆盖](../evidence/runtime-legacy-coverage.json) 为 44/44，**不是一次新的 44 题全量通过** |
| 指标 SQL      | 最终资源配置下重新执行 14 条真实 SQL，全部匹配独立参考；[指标记录](../evidence/live-metrics.json)                                                                                          |
| HTTP          | [6/6](../evidence/runtime-http.json)，5 completed、1 limited，含推荐执行与过期动作拒绝                                                                                                     |
| 浏览器        | fixture 与 Live 均通过；Live 实际绘制并核对全部 60 个非空点、Reviewer 后续查询、刷新恢复、取消、记忆和数据缺失状态                                                                         |
| 连续 SQL 负载 | 15 种规格各 4 轮，共 60 次分析、124 条 SQL，rows/comparisons/coverage 均与已核算参考一致，driver 容器及启动时间未变化；[负载记录](../evidence/zetaris-memory-soak.json)                    |
| 展示预检      | [6/6](../evidence/demo-preflight.json)：API 1.4.0、真实数据与模型在线、教学数据披露、OpenAPI、Vite CORS                                                                                    |

最终五轮新会话均 completed；耗时分别为 19.6、27.4、59.7、14.0、24.9 秒，中位 24.9 秒，最长 59.7 秒；首事件 6–9 ms，每轮 3 次模型调用、2 条 SQL，JSON 修复合计为零。五轮均有具体 TipTop 结论与 Evidence 绑定，仍执行 Why Reviewer。模型提前选择渠道分组，减少了重复查询；原基线从整体开始调查，两者用户指定条件相同，Agent 自选分组和附加指标不同。业务消息输入字符中位为 34,478（原基线 55,389），这不代表 token 或费用。见 [最终五轮](../evidence/runtime-after.json) 与 [比较及限制](../evidence/runtime-comparison.json)。

相对初始中位 38.0 秒，这组最终观测约低 34.5%；期间发生重启、heap 与 Docker 预算调整，因此不能将该差值全部归因于代码。原先失败的第五轮、arena 单独调优失败、8 GiB 预算不足以及早期图表覆盖遗漏均原样保留。10 GiB 配置的连续 SQL 阶段最高抽样占用约 58.9%；后续 SQL、浏览器和五轮调查结束时约 68.1%，六个原有容器均 healthy。有限负载通过不表示长期内存增长已经解决。

主会话完成 correctness review，重点检查取消后的迟到结果、SSE cursor、当前追问窗口、事实引用、完整图表来源、错误与重试、SQL 并发及资源边界；未启动 subagent workflow。范围内没有尚未解决的后端阻断项。阶段 2 的 4d55f98 已按授权推送；后续优化验证后本地合并，本次不继续 push。

当前远程只含 main，尚无队友 React 页面。后端提供完整可运行的浏览器联调与 Demo 预检，但实际 React 路由验收、团队三分钟预演、业务人工验收、录屏、slides 与赛事提交仍由团队在对应页面/材料就绪后完成。正式展示步骤见 [Demo 脚本](demo-script.md)。
