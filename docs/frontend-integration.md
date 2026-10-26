# React / TypeScript 接入

后端默认 `http://127.0.0.1:3100`，UI 由队友构建。共享包 `@storewhy/contracts` 同时提供 TS types、Zod schema 和浏览器客户端。包使用 TS 源码导出，Vite 可直接处理。新建 UI 时放到 `apps/web`，并在其 package.json 声明 `"@storewhy/contracts":"*"`，在根目录执行 `npm install`。

## 最小交互

```ts
import { StoreWhyClient } from "@storewhy/contracts/client";
import type { Run, RunEvent } from "@storewhy/contracts";

const api = new StoreWhyClient("http://127.0.0.1:3100");
const conversation = await api.createConversation();
// 保存 conversation.id；页面刷新后可 api.conversation(id) 恢复条件和历史 runIds。
const queued = await api.send(
  conversation.id,
  "为什么2019年7月比6月费用增长，14天收入却没有同步增加？",
);
const unsubscribe = api.subscribe(
  queued.id,
  (event: RunEvent) => appendProgress(event),
  async () => showRun(await api.run(queued.id)),
);
// 组件卸载时 unsubscribe()；断开 SSE 不会取消后台调查。
// 用户点击取消：await api.cancel(queued.id)。
```

`appendProgress` 与 `showRun` 由 UI 实现。首次请求返回 **202 queued**；不要把它当成最终报告。SSE 包含历史事件，可在订阅前已经完成时正常回放；最后 `done` 表示获取最终 Run。重新连接时 EventSource 会传 Last-Event-ID，手动恢复也可加 `?after=<seq>`。后端心跳每十五秒发送；SSE 断开时可轮询 `api.run(id)`。

## 条件编辑与追问

```ts
await api.send(id, "只看 FaceBoom", {
  patch: { filters: { channels: ["FaceBoom"] } },
});
await api.send(id, "窗口改成7天", { patch: { windowDays: 7 } });
await api.send(id, "清除渠道限制", { patch: { filters: { channels: [] } } });
await api.send(id, "开始新分析", {
  newInvestigation: true,
  patch: { metrics: ["new_users", "revenue"] },
});
await api.rememberWindow(id, 7);
```

这些调用须等待上一次完成；同一会话并发提问返回 **409 CONVERSATION_BUSY**。UI patch 被视为明确的用户意图，跳过语言提取，后续仍执行相同数据校验和调查流程。未写入 patch 的字段继承；数组替换而不是追加；空数组清除该项筛选。`newInvestigation` 清除临时条件，读取该会话已保存的默认窗口。普通追问不会自动成为长期偏好。

设备/国家分析时，patch 的 `metrics` 要移除 `spend`、`cost_per_new_user`、`revenue_to_spend`，否则后端会返回 unsupported，避免把渠道总费用错误分配给子人群。

时期为 `[start,end)`；七月的 end 是 `2019-08-01`。日期编辑需同时给出该轮完整 periods 数组，最多两个。两时期标签必须不同。趋势设置 `mode:'calendar', timeGrain:'day'|'week'|'month'`；恢复汇总设置 `timeGrain:null`。周起点为周一，缺失日期不自动补零。每次完整结果最多两百行，超过时缩小日期或筛选范围。

## 页面需要展示的字段

- `run.context.spec`：本轮已经执行的完整条件。不要只显示用户最后一句话。
- `run.answer.summary/findings/checkedExplanations/limitations/nextSteps`：报告内容，普通文本渲染，不使用危险 HTML。
- `run.answer.facts[]`：数字卡，含 `evidenceId`、`rowIndex`、`metric`、`value`；finding.factIds 对应这些卡。fact.id 在单个 Run 内使用；跨轮缓存请用 run.id 加 fact.id，避免引用旧轮次。
- `api.evidence(id)`：真实 SQL、queryIds、结果、定义、数据版本、观察期排除人数；`comparisons` 含两时期差额和相对变化。
- `evidence.rows[].bucket`：趋势桶起点；无 bucket 时用 period。相对变化/比例使用小数，显示百分比时乘百。金额不添加美元符号；`null` 显示“不可计算/数据缺失”。
- `modelTraces`：真实 provider/model，可在详情中显示；responseFormat 记录是否请求 JSON object，仍需本地校验，不表示 schema 保证。普通用户不必看技术信息。

## 具体结论与推荐追问（API 1.2.0 新增）

```ts
const run = await api.run(runId);
const conclusion = run.answer?.conclusion?.text ?? run.answer?.summary;
const keyEvidence = run.answer?.keyEvidence ?? run.answer?.findings ?? [];
const actions = run.answer?.followups ?? [];

// 用户点击推荐后提交，与普通消息一样返回 queued Run。
const queued = await api.followup(action);
```

新字段均可选，兼容旧 Run。conclusion/keyEvidence 各自携带 factIds，可展开到当前 facts 和 Evidence。按钮使用 action.label，推荐理由使用 action.reason；action.patch 是完整目标条件，basedOn 包含上下文版本。若返回 409 STALE_CONTEXT，刷新当前条件和推荐，不自动绕过版本校验重试。同一会话仍须等待上轮结束。

完整字段、错误处理、历史去重与展示规则见 [回答契约](answer-contract.md)；队友可用 [完整 Answer mock](examples/answer.json) 先搭组件。demo 提供结论和关键证据，执行推荐则需要实际 Conversation。limited 回答可以有具体数字，同时必须保留证据缺口。

## 图表接入（API 1.1.0 新增）

```ts
import { chartResponseSchema } from "@storewhy/contracts";

// Agent 的最终回答已经附带图表；旧 Run 没有这个字段时按空数组处理。
const run = await api.run(runId);
const charts = run.answer?.charts ?? [];
const notices = run.answer?.chartNotes ?? [];

// 也可以从已有 Evidence 单独获取，不额外调用模型或执行 SQL。
const response = chartResponseSchema.parse(
  await api.evidenceCharts(evidenceId),
);
```

支持 `bar`（时期/渠道对比）、`line`（日/周/月自然时期趋势）、`stacked_bar`（首次与后续购买收入构成），每次最多两张。数据点含 `source: {evidenceId,rowIndex,metric}`，可通过 `api.evidence` 展开真实查询结果、SQL 和 queryId。展示以 `chart.source.spec/coverage` 为准，按 `point.key` 对齐系列；缺失值保留 null，比例只在显示时乘百，金额不加货币符号。

首版使用确定性规则从已执行结果选图，不增加模型调用。完整规则、单位表、断线方式、缓存和点击渠道追问代码见 [图表契约](chart-contract.md)。免凭据开发可直接使用 `(await api.demo()).answer.charts` 或 [三类离线 mock payload](examples/charts.json)；mock 的 Evidence 嵌在文件内，ID 不对应服务器。新追问完成后替换图表，不沿用旧图的证据。

## 状态与错误

| 状态                | UI 行为                                       |
| ------------------- | --------------------------------------------- |
| queued / running    | 展示进度与取消按钮，暂时禁用同会话提交        |
| completed           | 展示最终回答和证据                            |
| limited             | 展示有限结论与仍待核查事项                    |
| needs_clarification | 展示 message，等待补充条件                    |
| unsupported         | 展示 message 中的数据缺口，保留上一次有效条件 |
| no_data             | 当前范围无可用记录，不显示伪造结论            |
| failed              | 展示 message，允许重试；Live 错误不会回退样例 |
| cancelled           | 显示已取消，可继续提问                        |

HTTP 校验错误统一 `{error:{code,message,retryable}}`，400 为参数，404 为记录不存在，409 为会话忙或推荐上下文已过期，429 为容量限制，503 为外部服务不可用。最多两个会话同时运行。运行中发生的错误写入 Run 和 SSE，消息接口本身仍已返回 202。

SSE type：progress、run_started、scope_updated、hypothesis、query_started、query_completed、review_completed、memory_recalled、answer_ready、clarification、error、cancelled。使用 seq 去重。error 也可能是 EventSource 连接错误，仅在事件带 data 时解析 JSON。

## 接口表

| Method | /api/v1 路径                                 | 返回                                       |
| ------ | -------------------------------------------- | ------------------------------------------ |
| GET    | /catalog                                     | 字段、日期范围、能力与限制                 |
| GET    | /integrations                                | 模型/数据连接状态                          |
| POST   | /conversations                               | Conversation，201                          |
| GET    | /conversations/:id                           | 当前条件与历史 runIds                      |
| POST   | /conversations/:id/messages                  | Run，202                                   |
| GET    | /runs/:id                                    | Run                                        |
| GET    | /runs/:id/events                             | SSE，可恢复                                |
| POST   | /runs/:id/cancel                             | 取消请求或已结束 Run                       |
| GET    | /evidence/:id                                | Evidence                                   |
| GET    | /evidence/:id/charts                         | ChartResponse，至多两张，绑定已有 Evidence |
| POST   | /analytics/query                             | AnalysisSpec → Evidence，直接数据查询      |
| GET    | /conversations/:id/memory                    | 不含 embedding 的记忆列表                  |
| POST   | /conversations/:id/preferences/window        | `{windowDays:7或14}`                       |
| POST   | /conversations/:id/memory/:memoryId/feedback | `{kind:'helpful'或'not_helpful'或'wrong'}` |
| GET    | /demo                                        | 自制 fixture 回放，kind:fixture_replay     |
| GET    | /openapi.json                                | OpenAPI 3.1                                |

本机未配置模型时可先用 `/demo` 开发结果展示，再用 `/analytics/query` 开发图表。需要动态自然语言和 Why 调查时配置 Nightshift。`GET /healthz` 的 dataMode 区分 fixture/zetaris；不要把自制样例称作真实在线调查。

### Why 解释状态（API 1.3.0）

可选 `answer.explanations` 提供支持、反驳、数据不足、未检查四种状态。请显示 claim、status 和 text，并用 factIds 展开数字来源；随访检查通过 coverageRefs 展开 Evidence.coverage。完整字段和标签含义见 [回答契约](answer-contract.md#why-解释检查api-130)。

即使 completed 也展示 limitations，尤其是十月批次裁剪。unsupported 本轮显示 run.message，不复用上一轮结果。只改时期或筛选的追问继承 Why 目标，修改后使用最新回答里的推荐。Context.objective 保留最初问题的历史文字；当前窗口、日期和筛选以 run.context.spec 为准，不要用历史文字中的旧窗口代替本轮条件。

## 运行进度、错误与恢复（API 1.4.0）

新增字段全部可选，兼容旧 Run：

- `run.progress: {phase,label,round?,updatedAt}` 是当前真实阶段；SSE 的每个事件可带 `progress`，并新增 `progress` type。普通用户显示 label，不展示模型自由推理或伪百分比。
- `run.timing` 包含 totalMs、分段 steps（intent/query/explain/review/presentation）、modelCalls、repairCalls、sqlCount。sqlCount 为成功返回的 Evidence 中的实际 SQL 条数；失败的完整尝试可从 timing/trace outcome 看出。普通用户无需显示这些工程细节。
- `run.error: {code,retryable}` 与现有 message 配合展示。failed/cancelled/unsupported 本轮不要复用上次 Answer。`warnings` 是非阻断提示，例如分析完成但可选记忆暂未保存。

phase：understanding、querying、explaining、reviewing、presenting、cancelling、complete、needs_input、failed、cancelled。查询分组变化会报告“正在检查渠道差异”等真实进度；Reviewer 发现缺口不代表补查必然执行，只有查询实际开始才报告查询阶段。

刷新后的推荐恢复方式：

```ts
const { conversation, run, after } = await api.resume(savedConversationId);
if (run) {
  showRun(run); // 先恢复 scope 和 run.progress
  if (run.status === "queued" || run.status === "running") {
    const stop = api.subscribe(
      run.id,
      appendProgress,
      async () => {
        showRun(await api.run(run.id));
      },
      {
        after,
        onConnectionChange: (state) => showConnection(state),
        onError: (error) => showConnectionNotice(error.message),
      },
    );
    // 页面卸载时 stop()。断开 SSE 不取消后台调查。
  }
}
```

SDK 对事件按 seq 去重。连接状态由 onConnectionChange 提供 connecting/open/reconnecting/closed；native EventSource 永久关闭时报告 closed，不会宣称仍在重连，可改用下面的状态轮询。后端取 query.after 与 Last-Event-ID 的较大值；超过当前 Run 序号返回 400 CURSOR_AHEAD，此时重新读取 Run 恢复。不要把其他 Run 的 cursor 用到本轮。

SSE 暂时不可用时，可 `await api.waitForRun(runId,{signal,pollIntervalMs:1000,timeoutMs:370000})` 轮询至终态。等待超时返回 WAIT_TIMEOUT，后台任务仍可恢复；取消等待用 AbortSignal，取消调查用 api.cancel，两者不同。实际 React 组件应在卸载时 abort 并关闭订阅，且应用结果前核对当前 run.id，避免旧请求覆盖新页面。

`StoreWhyClientError` 提供 code/status/retryable。消息 POST 从不自动重试；网络中断后先 resume，确认是否已创建 Run，再决定新提交。同会话运行中重复提交返回 CONVERSATION_BUSY，容量限制为 CAPACITY。retryable 只用于提示用户可以重试，不代表立即自动再发问题。

| code                                      | 展示/处理                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| ZETARIS_ERROR / MODEL_ERROR               | 服务返回错误，显示 message；按 retryable 提示恢复或重试，不显示旧 Answer |
| MODEL_TIMEOUT / RUN_TIMEOUT               | 本轮超时，无新 Answer；允许用户重试或缩小范围                            |
| ZETARIS_OFFLINE / ZETARIS_TIMEOUT         | 数据不可用，保留当前条件；绝不冒充 fixture 成功                          |
| MODEL_UNAUTHORIZED / ZETARIS_UNAUTHORIZED | 检查本机连接授权，不自动重试                                             |
| SERVER_RESTARTED                          | 旧调查中断，可重新提问；原 Run 可读取终态                                |
| CANCELLED                                 | 显示取消，允许开始新问题                                                 |
| BACKEND_OFFLINE / REQUEST_TIMEOUT         | 前端连接失败，优先 resume 检查原 Run                                     |
| INVALID_RESPONSE / WAIT_TIMEOUT           | 提示读取/等待失败；保留 conversationId/runId 以恢复                      |

独立浏览器联调工具位于 `tests/browser`，`npm run test:browser` 使用明确标注的自制样例；`npm run test:browser:live` 使用实际 Zetaris/Nightshift。它验证刷新、图表逐点来源、追问、取消与有来源的偏好恢复，不替代队友 React 页面验收，不发布网站。默认使用 macOS Chrome，可用 STOREWHY_CHROME 指向本机 Chrome/Chromium 可执行文件。
