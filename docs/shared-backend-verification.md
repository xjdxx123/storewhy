# 共享后端验证记录

2026-10-26，新增远端 UI 启动器、短时鉴权中继和临时 HTTPS 隧道启动器。未修改 Agent 调查逻辑、指标或 SQL。

- `npm test`：154/154 通过，其中 4 项新增测试覆盖先鉴权后转发、错口令/到期/离线、路径和方法限制、凭证剥离、请求体保留与连接配置校验。
- `npm run test:shared-ui`：8 项通过；真实现有 Zetaris/Nightshift/NVIDIA，连接路径为本机受保护中继。主 Why completed，60 个实际图表点逐一核对 Evidence；刷新只有一次提问；FaceBoom 追问继承窗口并生成新证据；25 次实际 Run 读取、0 次 SSE、0 个浏览器 console error。
- UI 在没有供应商配置的子进程中独立构建/启动/退出；构建产物和浏览器请求头不含分享口令，构建产物不含本机供应商密钥；UI 退出后原后端仍可访问。
- `npm run test:ui`：原本机 UI 的 10 个调查/故障场景及渲染边界、移动布局通过，保留默认 SSE 行为。
- `npm run typecheck`、`npm run lint`、`npm run build`、`git diff --check` 通过；18 个候选文本文件扫描未发现本机 5 项私有凭证。
- 主会话 review 检查了路由/方法/目标限制、到期、请求凭证剥离、共享进程退出、UI 代理与正常 SSE 回归；补上畸形 URL 的 400 响应、退出时等待所创建的 cloudflared 子进程、以及有总期限的公网检查。公网进程生命周期尚待授权后实测。

证据：[本地真实联调](../evidence/shared-ui-local.json)、[截图](../evidence/shared-ui-local.png)、[单元测试](../evidence/shared-backend-unit.json)。

公网部分仍待验证：自动审批拒绝了首次启动 Cloudflare 隧道，理由是用户尚未明确授权分析请求和结果经过该第三方服务。尚未生成可给队友的公网连接文件，也不能宣称队友跨网络已可用。授权后运行 `npm run share:backend`，再执行 `npm run test:shared-ui -- --public`；维护者本机走过公网的检查通过后，仍需要队友自己的电脑预跑一次。

Cloudflared 客户端已从官方发行包下载并核对 SHA-256；安装元数据在 `evidence/shared-cloudflared-install.json`，二进制及私有连接配置均在 Git 忽略的 `.state/`。未调整仓库可见性、未上传赛事材料、未提交供应商凭据。
