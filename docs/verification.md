# 后端验收与 correctness review

日期：2026-10-25。代码基准：86483f4。后端执行范围已完成；React UI、浏览器联调和正式赛事提交不在本次已完成范围内。

| 检查                     | 结果与证据                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 本地自动化               | 50/50 通过，其中本项目 40 项、H-MEM 上游 10 项                                                                                                                           |
| lint / typecheck / build | 全部通过；编译产物用普通 Node.js 启动                                                                                                                                    |
| 干净副本                 | npm ci、50 项测试、lint、typecheck、build、fixture 启动及示例回放；[记录](../evidence/clean-setup.json)                                                                  |
| 依赖审计                 | npm audit：0 vulnerabilities。安装提示 ESLint 9 的维护期警告，检查仍通过                                                                                                 |
| Zetaris 接入             | 五张表登记/刷新、三张原始表行数正确；[记录](../evidence/data-registration.json)                                                                                          |
| 独立数值核算             | Python 标准库直接遍历原始 CSV，与 SQL 编译实现独立；H7/H14 与自然月核对通过；[参考](../evidence/reference-metrics.json)、[实际 14 条 SQL](../evidence/live-metrics.json) |
| 固定问题                 | 12/12 正确处理                                                                                                                                                           |
| 调试用改写回归           | 10/10 正确处理                                                                                                                                                           |
| 全新保留问题             | 10/10 正确处理；未写入产品 prompt 或按完整题目匹配的路由                                                                                                                 |
| 首轮多轮检查             | 三组各四轮，连同上述问题合计 44/44；[完整记录](../evidence/agent-evaluation.json)                                                                                        |
| 加强后的追问检查         | 12/12，增加 Why 目标和清除筛选后月份不变的验收；[记录](../evidence/followup-evaluation.json)                                                                             |
| 最终报告补查覆盖         | 最新主调查与简单查询 2/2；[记录](../evidence/agent-smoke.json)                                                                                                           |
| 实际 HTTP / SSE          | CORS、OpenAPI、202、可恢复事件、Run、Zetaris Evidence；[记录](../evidence/http-smoke.json)                                                                               |
| HTTP 完整 Agent          | 真实 NVIDIA Investigator / Reviewer，补查后返回；[记录](../evidence/http-agent-smoke.json)                                                                               |
| 最终 Why 示例            | [报告与 SQL](../evidence/why-example.json)，含 TipTop 费用增加但同口径收入减少的观测                                                                                     |

## 审查结论

主会话完成独立于实现步骤的 correctness review，未启动开发 subagent workflow。已解决的阻断项包括：源费用逐行舍入误差、访问/购买/费用连接放大、未成熟批次与费用不同步、设备/国家成本越界、相对日期被替换、清除筛选改动月份、追问丢失 Why 目标、报告漏用新增补查、编译产物遗漏 workspace 依赖，以及服务关闭时 SSE 未退出。

金额、分母、源粒度、随访边界与结果完整性由代码约束。Agent 只能请求白名单分析规格，不能提交任意 SQL；最终数值句从已执行结果生成。未知观测 ID 被拒绝；报告保留最新补查的代表性事实。模型未完全通过审查时返回 limited，不将其解释当作已证明因果。

## 性能与实际限制

完整样本中简单查询的中位耗时约 7.8 秒，Why 样本约 37—39 秒；最终主调查约 45 秒，HTTP 端到端一次为 63.6 秒。NVIDIA 曾出现一次约 132.8 秒的设备问题等待，不能把常见耗时当作保证。当前单次意图 30 秒、调查/审查 90 秒、SQL 90 秒，整轮上限六分钟；支持取消并在异常时返回真实错误。

Super 系列的若干路由虽然出现在 Runtime 模型列表中，但实际调用失败；已选择实际验证可用的 nvidia/nemotron-3-ultra-550b-a55b。开发期间失败记录保留在 [development-regression](../evidence/development-regression.json)，未计入通过记录来掩盖失败；上述结果是修复后的回归与保留问题验收。

后端是本地单进程 MVP，以 JSON 原子替换持久化。没有互联网用户认证、多实例共享状态、任意数据上传、真实广告账户修改或广告因果推断。原始教学数据许可未确认，不提交原始 CSV。浏览器验收、队友 UI、录屏与 slides 成品、代码 push 和正式发布仍待团队后续完成。

## 2026-10-25 图表后端增量验收

图表契约与证据绑定已完成，API 版本升为 1.1.0；React 渲染和浏览器图表验收仍由 UI 接入阶段完成。

- 完整测试 75/75 通过，新增 25 项覆盖数值、单位、null、时间桶、收入组成、篡改拒绝、HTTP、追问更新和文档 payload；lint、typecheck、build 通过。
- 真实 Zetaris HTTP 验证：渠道费用/收入各 20 个点；自然月趋势 2 个实际桶；首次/后续收入堆叠 4 个点。所有点均与所指 Evidence 单元格一致。
- 真实 NVIDIA Why 调查 completed，约 43.2 秒；后续“只看 TipTop、改七天”返回 limited，约 37.4 秒。后者表示解释仍有证据缺口；图表的时期、七天窗口、TipTop 筛选和新证据引用均核对通过，不把图表误当作审查通过的因果解释。
- 增量验收通过隔离的 3121 Live 服务执行；[记录](../evidence/charts-verification.json) 中的 ID 属于该测试服务，与默认 3100 服务的存储分开。
- GET /evidence/:id/charts 读取已有 Evidence；Answer 新字段可选，旧 Run 仍可读取。源 SQL/指标定义不变；图表不新增模型或 SQL 调用。
- 主会话完成 correctness review，重点核对逐点来源、图形单位、系列分组、完整行覆盖和追问旧证据隔离，未启动 subagent workflow。修复了 Demo Evidence 无法通过 API 展开的问题；源标签与图表标题也纳入校验。

接入与边界见 [图表契约](chart-contract.md)，离线数据见 [自制 fixture mock](examples/charts.json)。

## 2026-10-25 回答质量增量验收

API 1.2.0 已实现具体结论、关键证据与可执行追问；接入见 [回答契约](answer-contract.md)。

- 完整自动化 91/91，含新增 16 项回答/追问检查；lint、typecheck、build 全部通过。独立 CSV 参考与真实 Zetaris 14 条 SQL 复核通过。
- [最终六项 Live 记录](../evidence/answer-quality-evaluation.json)：主 Why、连续两次推荐、八/九月变化、FaceBoom 反例、七月收入查询；全部通过事实绑定、范围、回答目标和推荐校验。五轮 completed；FaceBoom 为 limited，保留进一步解释未完成的状态。
- 主问题约 51.3 秒；点击付费表现约 5.9 秒，结论为 10.15%→9.17%、下降 0.98 个百分点；首次/后续收入推荐约 3.3 秒，分别减少 176.65、424.19。数字均有本轮事实与 Zetaris 结果引用；这是本次样本耗时，不是延迟保证。
- 已验证旧推荐返回 409 STALE_CONTEXT 且不修改会话，新动作明确携带任务类型，避免被范围追问纠正规则错误覆盖；显式 Why 即使带 UI patch 也进入 Reviewer 路径。
- [开发记录](../evidence/answer-quality-development.json) 保留筛选摘要写“整体”、Why 误分类和推荐沿用错误目标的问题。修复后重新验收，未将这些问题混为解释质量通过。
- 主会话完成 correctness review，核对主结论 ID 必须在已选观测内、事实引用、渠道增减相加、比例单位、scope 继承和新问题目标切换，未启动 subagent workflow。
- 此次评测通过隔离 3122 服务执行；记录中的 ID 属于该服务。React 浏览器验收、更广的阶段 2 问题覆盖与性能优化仍待后续执行。

## 2026-10-25 Why 扩展评测与可靠性（阶段 2）

范围：8 个新 Why，覆盖 5/6、6/7、7/8、8/9、9/10 月，渠道、设备、国家、首次/后续购买及成熟度；2 个前提错误/缺数据反例；两组各 3 轮追问。问题只存在于评测脚本，未加入 Agent 提示或渠道路由。

先记录 7ac88cc 的基线，再修复：6 轮出现范围/指标/目标错误，15 个有回答的轮次缺少结构化解释状态。基线的 1/16 是按新增验收标准得到，不能解释为旧版只有一项统计正确。基线反例已能指出 FaceBoom 费用减少、收入增加，缺少点击数据也已返回 unsupported。

实际修复：纯时期追问保留原 Why 目标和 Reviewer；自然月对比不误设趋势；十月请求保留完整月份，成熟度裁剪仅在 coverage 中；明确收入指标不会因模型遗漏而消失；比例/收入构成问题直接给对应结论；覆盖警告不能代替数字结论。费用与收入反向时先纠正前提。Reviewer 区分 calendar/cohort、首次/后续购买与新/老用户；ready 还需至少一项已执行的非随访解释检查。

API 1.3.0 可选 explanations 的状态由实际聚合证据生成。supported/contradicted 针对 claim 代表的观测检查，不是因果归因；not_checked 不能当排除。随访使用 coverageRefs。旧字段、图表和追问执行接口保留，UI 接入见 [回答契约](answer-contract.md)。

验证命令：

```bash
npm run eval:why -- --output=evidence/why-reliability-final.json
npx tsx scripts/audit-why.ts evidence/why-reliability-final.json
python3 scripts/verify-why-reference.py evidence/why-reliability-final.json
npm run eval:live -- --output=evidence/why-reliability-regression.json
npm test
npm run lint
npm run typecheck
npm run build
npm run test:live
```

最终工程验收为 111/111 tests、16/16 新集及确定性审计（13 completed、2 limited、1 unsupported）、旧 Live 44/44、HTTP 6/6，lint/typecheck/build 与 14 条真实指标 SQL 通过。重复评测另识别并修复默认人群漂移；最终四轮比例复测修复了小渠道上涨掩盖汇总下降的首句。逐题审阅和来源见 [阶段 2 记录](why-reliability-review.md)，外部人工业务验收未执行。本阶段未实现阶段 3 性能优化；开发轮自然月案例曾耗时约 192 秒，模型延迟和补查长尾仍需单独优化。没有把第一次/后续购买直接改称新客/老客，没有广告因果实验或点击/曝光数据，也没有宣称穷尽所有解释。

最终独立 CSV 核算：1,084 项核对通过，覆盖 18 种实际执行规格，并包含完整渠道金额汇总的派生比值。所有改动仅在本地；GitHub push 由用户另行明确授权。

## 2026-10-25 Runtime 与接入增量验收（API 1.4.0）

阶段 2 的 Why 可靠性优化、评测与接入材料已按授权 push，远程 main 为 4d55f98。后续本轮实现与本地验收详见 [Runtime 完整记录](runtime-verification.md) 与 [机器可读汇总](../evidence/runtime-final-acceptance.json)。

- 最终 150/150 自动化测试、lint/typecheck/build 通过；Why 16/16（14 completed、1 limited、1 unsupported），独立 CSV 核算 1,054 项/15 种规格，真实指标 SQL 14 条，HTTP 6/6。
- 旧集首轮 43/44，一项真实模型超时；受修改影响的 16 题与全部 12 轮追问复测 28/28，组合覆盖 44/44，未将首轮失败改记成功。
- 五轮真实主调查均 completed，中位 24.9 秒、最长 59.7 秒；每轮 3 次模型调用、2 条 SQL、零 JSON 修复，首事件 6–9 ms。保留 n=5、Agent 查询选择、模型波动与本机资源调整的限制。
- 真实浏览器联调覆盖恢复、追问、窗口、记忆、取消、Reviewer 实际补查和缺数据停止；全部 60 个非空图表点与 Evidence 一致，无 console error。这是 test-only 工具，尚未验收队友 React 页面。
- 本机 Docker 资源预算从 8092 调为 10240 MiB，driver 使用 arena=2/heap=1g，原六个容器恢复并 healthy；最终连续 60 次分析/124 条 SQL 数值与参考一致、无 driver 重启。历史 OOM 和失败负载保留，有限通过不保证长期不会 OOM。[本机配置与复现](local-runtime-profile.md)。
- 主会话完成代码与验收材料 review，后续优化验证后本地合并；未继续 push。实际 React UI、团队预演与外部业务验收仍待团队完成。
