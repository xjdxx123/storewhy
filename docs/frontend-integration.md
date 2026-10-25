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
- `modelTraces`：真实 provider/model，可在详情中显示；普通用户不必看技术信息。

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

HTTP 校验错误统一 `{error:{code,message}}`，400 为参数，404 为记录不存在，409 为会话忙，429 为容量限制，503 为外部服务不可用。最多两个会话同时运行。运行中发生的错误写入 Run 和 SSE，消息接口本身仍已返回 202。

SSE type：run_started、scope_updated、hypothesis、query_started、query_completed、review_completed、memory_recalled、answer_ready、clarification、error、cancelled。使用 seq 去重。error 也可能是 EventSource 连接错误，仅在事件带 data 时解析 JSON。

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
| POST   | /analytics/query                             | AnalysisSpec → Evidence，直接数据查询      |
| GET    | /conversations/:id/memory                    | 不含 embedding 的记忆列表                  |
| POST   | /conversations/:id/preferences/window        | `{windowDays:7或14}`                       |
| POST   | /conversations/:id/memory/:memoryId/feedback | `{kind:'helpful'或'not_helpful'或'wrong'}` |
| GET    | /demo                                        | 自制 fixture 回放，kind:fixture_replay     |
| GET    | /openapi.json                                | OpenAPI 3.1                                |

本机未配置模型时可先用 `/demo` 开发结果展示，再用 `/analytics/query` 开发图表。需要动态自然语言和 Why 调查时配置 Nightshift。`GET /healthz` 的 dataMode 区分 fixture/zetaris；不要把自制样例称作真实在线调查。
