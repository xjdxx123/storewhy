# 图表数据契约 v1

后端 API 版本为 `1.1.0`，单张图的 `version` 为 `1.0.0`。共享 TypeScript/Zod 导出位于 `@storewhy/contracts`：`Chart`、`ChartPoint`、`ChartResponse`、`chartSchema`、`chartResponseSchema`。这是面向 React 图表组件的数据契约，后端不返回图片二进制或可执行绘图代码。

## 获取图表

完整 Agent / 普通查询回答增加可选字段：

```ts
const run = await api.run(runId);
const charts = run.answer?.charts ?? [];
const notices = run.answer?.chartNotes ?? [];
```

旧持久化 Run 可以没有这两个字段。`queued/running` 尚无最终图表；SSE `done` 后获取 Run。`limited` 的图表展示已经查到的观测，解释的审查状态仍看 Run 和 answer；有图不代表已证明原因。

单独使用已有 Evidence：

```ts
const evidence = await api.query(spec);
const { charts, notes } = await api.evidenceCharts(evidence.id);
// GET /api/v1/evidence/:id/charts
```

该 GET 只读取已保存的结果，不调用模型、不新增 SQL。无 ID 返回 404，无效 ID 返回 400；结果截断、无行或无可绘制数值时返回 200、空 charts 和原因 notes。

免模型开发入口 `await api.demo()` 返回自制 fixture 及 `answer.charts`；其中 Evidence 已保存，可通过 `api.evidence(id)` 展开。离线 mock 使用 [三类完整 payload](examples/charts.json)，每个 example 包含 Evidence 和 ChartResponse；该文件明确为自制 fixture，里面的 ID 不对应你的服务器记录。

## 字段与证据

每次最多两张图，每张图只使用一份 Evidence：

| 字段                                | 含义                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `id / version / type / title`       | 图表标识、协议版本、渲染类型和标题                                                |
| `xAxis.kind`                        | `category` 或 `time`                                                              |
| `yAxis.unit / label / zeroBaseline` | 数值单位、轴标题，定量轴包含零点                                                  |
| `missingValues`                     | 固定为 `gap`，缺失值和缺失时间桶均不补零                                          |
| `source`                            | Evidence ID、数据/指标版本、fixture/zetaris、查询时间、完整 spec、coverage 和定义 |
| `series[]`                          | 系列 ID、名称、指标，以及可选的时期/维度                                          |
| `series[].points[]`                 | 实际查询结果的数值、类别键、时期、维度和可选时间桶                                |
| `point.source`                      | `{ evidenceId, rowIndex, metric }`，精确指向原始结果单元格                        |
| `notes`                             | 源数据说明和图表展示限制                                                          |

点的证据关系严格为：

```ts
const point = chart.series[0].points[0];
const evidence = await api.evidence(point.source.evidenceId);
const row = evidence.rows[point.source.rowIndex];
const value = row.values[point.source.metric];
// 后端保证 point.value === value，包括 null；并校验时期、维度、时间桶一致。
```

展开来源时显示 `evidence.sql`、`queryIds`、指标定义和覆盖范围。后端同时验证元数据、单位、标签和源结果覆盖，拒绝被篡改的数值、错误引用、重复行和遗漏类别。每张图对每个绘制指标保留全部源行，不做 Top-N 截取、其他渠道合并或隐式聚合。

`source.spec` 是该图实际查询的条件。补查可以改变 `groupBy/metrics`，不要用 `run.context.spec` 覆盖它。显示日期 `[start,end)`、calendar/cohort、cohort 的 7/14 天窗口、用户范围和筛选；coverage 若有排除人数或有效截止时间，也要展示。金额币种未注明，使用“样例金额”；时间使用源数据日期，不按浏览器时区平移。

图表不携带 Run 专属的 fact.id。跨回答缓存按 `run.id + chart.id`，Evidence 缓存按 `source.evidenceId`。追问完成后用新 Run 的 charts 替换图表；新图有自己的证据 ID，不把旧图条件改名后复用。

## 三种渲染规则

| type          | 系列和横轴                                                        | React 组件行为                                             |
| ------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| `bar`         | 一个指标；每个系列是一个时期，point.key 表示同一维度组合          | 分组条形图；按 key 对齐不同系列，不按数组下标配对          |
| `line`        | calendar 且有 day/week/month 时间桶；每个系列是一种时期与维度组合 | 按 bucket 绘制并保持系列分离；缺失或不连续的时间桶断线     |
| `stacked_bar` | 两个系列固定为首次、后续购买收入；point.key 包含时期与维度        | 相同 key 堆叠；两个时期分别成柱，禁止再把 revenue 总额叠加 |

不同系列的类别可能不同，按 key 的并集对齐；缺少的显示位置保留空白。`point.value === null` 显示“数据缺失/不可计算”，不用 `value || 0`。趋势点只包含实际查询桶；UI 如需插入 null 占位以断线，该占位没有来源，不能当成一个真实观测或添加可查询的 tooltip。按 source.spec.timeGrain 检查连续性，月、周、日分别处理；不跨渠道连线。

首版支持最多 64 个系列、每份 Evidence 最多 200 行。超限应缩小分析范围，不静默删除系列。后端优先选最近的查询证据；普通对比优先费用和收入，完整的首次/后续收入查询优先生成构成图。当前选择是确定性展示规则，不新增模型选图步骤。图表数据只有原值；差额见 Evidence.comparisons，尚无 waterfall 或贡献率协议。

| unit                      | 格式化                                                   |
| ------------------------- | -------------------------------------------------------- |
| `sample_amount`           | 样例金额，不能自动添加货币符号                           |
| `sample_amount_per_user`  | 样例金额 / 用户                                          |
| `sample_amount_per_payer` | 样例金额 / 购买用户                                      |
| `count`                   | 数量；具体是用户、访问还是购买看 metric/title/definition |
| `proportion`              | 原始小数不改变，仅格式化显示时乘百加 %                   |
| `multiple`                | 倍数，不格式化成百分比                                   |
| `hours`                   | 小时                                                     |

避免把数量和比例共用同一数值轴。用 title 和 series.label，保留零基线、负值和直接数值提示；颜色配合文字区分系列。图表不带审查结论或实验因果含义。

## 点击渠道承接追问

只在用户主动点击、当前调查已结束时提交，沿用现有追问接口：

```ts
import type { ChartPoint } from "@storewhy/contracts";

async function inspectChannel(point: ChartPoint) {
  const channel = point.dimensions.channel;
  if (!channel) return;
  await api.send(conversationId, `只看 ${channel}`, {
    patch: { filters: { channels: [channel] } },
  });
  // 等待 SSE done，获取新的 Run；其余时期和窗口继续继承。
}
```

设备/国家点击需同时移除费用类指标，规则与主接入文档一致。图表本身不包含自动执行的动作。PNG 导出、React 组件和浏览器验收由 UI 接入阶段完成；导出时也应保留范围和来源说明。

## 可重复验证

- `npm run docs:charts`：从自制 fixture 重新生成三类离线 payload。
- `npm test`：包含逐点绑定、缺失值、单位、时间桶、组成、篡改拒绝、HTTP、追问和样例契约测试。
- 在新版 Live 服务启动后运行 `npm run test:charts`：真实 Zetaris 三类图表和证据核对。
- `npm run test:charts -- --agent`：追加真实 NVIDIA Why 与 TipTop 七天追问验证，会使用已配置的供应商额度。
- 可用 `STOREWHY_HTTP_URL=http://127.0.0.1:3121` 指向隔离测试服务。结果保存到 `evidence/charts-verification.json`。
