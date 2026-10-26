# 轻量备用 UI

状态：步骤 1–5 已完成工程实现、验证与主会话 review；验证后本地合并，不 push。独立放在 apps/fallback-web，避免与队友 apps/web 冲突。React + TypeScript + Vite，复用现有 SDK/API，不改 Agent/指标逻辑，不 push。

1. 配置与页面骨架：提供本机启动/构建命令，暖白单页，响应式布局。完成标准：typecheck/build 通过。
2. 调查交互：提问、推荐追问、渠道/窗口快捷修改、新会话、进度、取消、刷新恢复、SSE 与轮询。完成标准：不重复 POST，旧异步响应不覆盖新 Run，错误不显示旧报告。
3. 结果与证据：结论、关键证据、解释状态、局限、三类图表、SQL/queryId 和点来源。完成标准：所有点可追溯，null 不补零，比例/金额单位正确。
4. 浏览器验证：fixture 验证实际 React 页面全流程、异常、刷新/断线与移动布局；有连接时执行真实主 Why 和追问。完成标准：保存结果与截图，不将 fixture 当 Live。
5. review 与交付：运行 tests/lint/typecheck/build，更新启动和联调文档，主会话 review 后本地 merge。不替代队友最终 UI 与团队预演。

## 验收记录

- React/Vite 独立工作区已完成，不修改队友 apps/web 或 Agent/SQL 逻辑；npm run dev:ui 提供本机 5173 页面，根目录检查包含新应用。
- 150/150 既有自动化测试、lint/typecheck/build 通过，npm audit 无漏洞。构建产物另经本机浏览器验证，API 代理可用，样例只读且明确标识。
- fixture 实际 React 页面 10 轮：7 completed、1 cancelled、1 unsupported、1 注入 failed；验证恢复不重复 POST、无 SSE 时轮询、提交不确定时先恢复、旧报告清除和移动端布局。
- 真实 Zetaris/Nightshift/NVIDIA 8 轮：4 completed、2 limited、1 cancelled、1 unsupported；全部 60 个非空图表点与实际 Evidence 数值一致。limited 保留缺口，没有算作完整因果解释。
- Review 发现趋势图跨缺失时间桶连线，先复现失败，再按日/周/月分别修正；添加跨年周/月、null、负值与堆叠的 SVG 检查。日期排序后按源粒度判断连续性，保留全部点来源。
- 主会话 review 核对会话恢复、异步结果隔离、错误与只读样例、模型/数据源标识、金额/比例单位、全量图表点和键盘关闭证据面板，无当前范围内阻断项。未使用 subagent。
- [使用说明](../fallback-ui.md)、[完整验收](../../evidence/fallback-ui-verification.json)。本轮不含团队现场预演、录屏、发布或赛事提交。
