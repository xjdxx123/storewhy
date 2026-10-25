# 具体结论与推荐追问（API 1.3.0）

本版保留现有 Answer 字段，并新增可选 `conclusion`、`keyEvidence`、`followups`。旧 Run 缺少新字段仍然可以展示。完整离线 payload 见 [answer.json](examples/answer.json)，包含自制 fixture 的 Context、Answer 和 Evidence；没有调用在线模型或 Reviewer，ID 不对应服务器。

## 展示顺序

1. **一句结论**：`answer.conclusion.text`；与 `answer.summary` 相同。直接展示渠道/人群、时期和已观测变化。`conclusion.factIds` 指向本轮 facts，便于展开来源。
2. **关键证据**：`answer.keyEvidence`，通常两至三条；单一指标查询可以只有一条。每条都是 `{text,factIds}`，重复引用同一批事实的内容会被压缩。
3. **已完成的检查**：`checkedExplanations` 列真实查询过的口径、分组和指标；不能把“查过”解释为证明了某个因果假设。
4. **限制**：`limitations`；`limited` 回答仍有具体数字，但结论会保留解释未完成的说明。
5. **推荐追问**：`followups` 最多三条；按钮显示 label，旁边或详情显示 reason。只在用户点击时提交。

旧 UI 仍可用 `summary/findings/nextSteps`；新 UI 应用 keyEvidence 控制主要篇幅，findings 可放详情。`nextSteps` 与推荐追问的完整 message 对齐。没有新的可用建议时 followups 可以为空。

```ts
const run = await api.run(runId);
const answer = run.answer;
const conclusion = answer?.conclusion?.text ?? answer?.summary;
const evidence = answer?.keyEvidence ?? answer?.findings ?? [];
const actions = answer?.followups ?? [];
```

数字来自已执行的观测，模型选择 headlineObservationId 和相关观测；不允许模型重写数字。主结论与关键证据的 factIds 只能在当前 Run 的 facts 中解析，再通过 `fact.evidenceId/rowIndex/metric` 找到原始单元格。渠道费用与收入的增减可以按完整渠道结果相加；付费比例以百分比显示，比例差以百分点显示；不把这些数字宣称为广告因果贡献。

## 追问结构与执行

共享包导出 `FollowupAction`、`followupActionSchema`、`ExpectedContext`、`expectedContextSchema`。

| 字段             | 用途                                                                            |
| ---------------- | ------------------------------------------------------------------------------- |
| `id`             | 本轮推荐的标识，用于列表 key；跨轮使用 run.id + id                              |
| `label / reason` | 简短按钮文案与推荐理由                                                          |
| `message`        | 发到聊天中的完整问题，包含日期、窗口、用户范围和筛选                            |
| `taskKind`       | query 表示明确的新指标查询；followup 表示沿用原目标修改范围；why 表示新解释问题 |
| `patch`          | 后端已经校验过的完整 AnalysisSpec，适合预览目标分析范围                         |
| `basedOn`        | conversationId、investigationId、数据/指标版本、revision                        |
| `evidenceIds`    | 产生建议时使用的当前轮证据                                                      |

```ts
import type { FollowupAction } from "@storewhy/contracts";

async function askRecommended(action: FollowupAction) {
  // 避免将另一个会话的推荐显示在当前会话。
  if (action.basedOn.conversationId !== activeConversationId) return;
  try {
    const queued = await api.followup(action);
    // 与普通 send 一样：等待 SSE done，再加载新 Run。
    subscribeToRun(queued.id);
  } catch (error) {
    if ((error as { code?: string }).code === "STALE_CONTEXT") {
      // 409：刷新当前 Conversation 与最新回答，请用户选择最新推荐。
      showNotice("分析条件已更新，请使用最新推荐。");
      return;
    }
    throw error;
  }
}
```

`api.followup(action)` 使用已有 `POST /api/v1/conversations/:id/messages`，请求体是：

```ts
{
  message: action.message,
  patch: action.patch,
  expectedContext: action.basedOn,
  taskKind: action.taskKind,
}
```

taskKind 用于带 patch 的结构化请求；普通自由提问仍由模型识别。推荐切换指标问题时更新目标，改窗口/拆分范围时继承目标。显式的“为什么/why”问题始终进入 Why 审查路径。

没有新的执行端点。202、SSE、取消与事实/图表读取方式不变。后端在创建 Run 前校验 expectedContext；不同会话、调查、数据/指标版本或 revision 返回 **409 STALE_CONTEXT**，不会分配新 Run 或修改条件。当前已有任务时仍返回 409 CONVERSATION_BUSY。普通自由提问的 expectedContext 可省略。

一条推荐执行后，旧回答里的其他推荐可能已过期；用新回答替换推荐，不能自动去掉 expectedContext 重试。patch 是当时完整范围，版本校验用于防止覆盖后来更改的筛选、月份或窗口。

## 建议怎样产生

首版根据实际结论和未完成的查询生成受控建议：定位结论中的渠道、首次/后续购买收入拆分、付费比例和每位购买用户收入、渠道拆分、另一个 7/14 天窗口，以及明确切换口径的自然月趋势。每条通过 validateSpec，保持未声明修改的时期、人群和筛选。费用粒度、organic、成熟窗口和支持指标限制同样生效。

同一调查最近十轮、相同数据/指标版本的完整查询会用于避免重复建议；新调查可以重新检查。比较相同口径下的指标覆盖，不拿其他国家/设备/渠道的数据当成当前筛选已经检查过。趋势不推荐直接展开成可能超限的全渠道每日结果。

这部分使用确定性规则，不新增一次模型调用。推荐可执行并不表示一定获得充分解释；执行后仍会返回真实的 completed/limited/no_data/failed 等状态。

`api.demo()` 提供新的结论与关键证据字段，但 followups 为空，因为它没有实际聊天会话；需要先 createConversation/send 获得真实可执行的推荐。离线 mock 只用于组件开发。

## 验证命令

- `npm run docs:answer`：重新生成自制 Answer mock。
- `npm test`：含具体结论、事实绑定、渠道抵消、比例显示、追问执行、过期拒绝和明确 Why 审查保护。
- 启动新版 Live 服务后运行 `npm run eval:answers`：主 Why、连续两轮推荐、另一组月份、FaceBoom 反例、简单查询；同时检查过期动作返回 STALE_CONTEXT。会使用已配置的 NVIDIA 额度。
- 可设置 `STOREWHY_HTTP_URL` 使用隔离服务；结果保存在 `evidence/answer-quality-evaluation.json`。

## Why 解释检查（API 1.3.0）

Why 回答新增可选 `answer.explanations: Explanation[]`。保留既有 `checkedExplanations`；旧 Run 没有 explanations 时按旧方式展示，不能把缺省当成所有解释都已排除。普通 query 不新增这些检查。

每条包含 `id / kind / claim / status / text / factIds / evidenceIds / coverageRefs`。UI 必须把 claim 与 status 一起展示：状态针对具体的观测命题，不代表发现了因果根源。

| status       | 建议标签 | 含义                                                 |
| ------------ | -------- | ---------------------------------------------------- |
| supported    | 观测支持 | 已执行结果符合该 claim；不能显示成“已证明原因”       |
| contradicted | 观测反驳 | 已执行结果与该 claim 不符；不代表排除其他所有解释    |
| missing_data | 数据不足 | 执行过相关查询，但时期无法配对、分母为空或分组不完整 |
| not_checked  | 尚未检查 | 本轮没有执行所需指标或拆分；不能宣称排除             |

检查覆盖用户规模、购买用户比例、每位购买用户收入、首次/后续购买收入构成、费用与收入前提、渠道差异及完整随访。规模、比例、每位付费用户收入的 supported 只表示与收入同向变化；它们不是可相加的广告贡献。分组检查的 text 会指出具体渠道/人群，来源 spec 包含完整 scope。

数值检查通过 `factIds → facts → evidence 单元格` 展开。随访检查使用 `coverageRefs: [{evidenceId,period}] → evidence.coverage`，因此 factIds 可以为空；不能为完整随访状态伪造金额事实。不要把 Reviewer 的事件 data.reason 当成经过数字校验的业务结论，用户报告以 Answer 中的确定性文字为准。

`completed` 表示 Reviewer 接受了本次可观测解释，且至少有一项非随访解释检查有证据；不是穷尽所有原因。`limited` 保留具体观测并披露缺口。`unsupported` 表示所需数据或能力不存在，读取 run.message，不显示上一轮 Answer 作为本轮结果。

对十月批次，context.spec 保留用户请求的完整月份；coverage 单独披露 effectiveEnd 与 excludedUsers。即使状态 completed，仍须展示裁剪限制：当前结论只涉及剩余完整观察窗口，不能推断被排除用户表现，也不能把不同有效获客天数的合计当作完整月份比较。

新增检查由后端的实际 Evidence 生成，不增加模型调用，也不会为了把状态都改成 supported 而查询全部分支。推荐追问、SSE、图表与事实接口不变。

验证：`npm run eval:why` 执行 8 个 Why、2 个反例、两组各 3 轮追问，逐题记录 scope、解释状态、Reviewer 补查与聚合证据。`python3 scripts/verify-why-reference.py evidence/why-reliability-final.json` 从本机原始 CSV 独立核对全部已执行聚合单元格和随访裁剪。

批次模式的默认人群为现有 Context 的付费渠道口径；没有用户指令时，模型不能擅自切到包含 organic 的全部用户。明确“所有用户/包含 organic”等要求仍生效。请始终显示 context.spec.audience；设备/国家筛选不会隐式改变人群。

多渠道的收入/费用比问题优先展示完整结果中的渠道金额汇总比值（总收入 / 总费用），随后展示主要渠道增减。它不是各渠道比值的算术平均。汇总结论绑定所有收入/费用 factIds；任一渠道缺少费用、时期缺行或结果不完整时，不生成该汇总。图表仍使用原始逐点值，不为汇总结论伪造原始行。
