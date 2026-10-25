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
