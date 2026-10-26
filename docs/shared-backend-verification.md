# 共享后端验证记录

2026-10-26，新增远端 UI 启动器、短时鉴权中继和临时 HTTPS 隧道启动器。未修改 Agent 调查逻辑、指标或 SQL。

- `npm test`：154/154 通过，其中 4 项新增测试覆盖先鉴权后转发、错口令/到期/离线、路径和方法限制、凭证剥离、请求体保留与连接配置校验。
- `npm run test:shared-ui`：8 项通过；真实现有 Zetaris/Nightshift/NVIDIA，连接路径为本机受保护中继。主 Why completed，60 个实际图表点逐一核对 Evidence；刷新只有一次提问；FaceBoom 追问继承窗口并生成新证据；25 次实际 Run 读取、0 次 SSE、0 个浏览器 console error。
- UI 在没有供应商配置的子进程中独立构建/启动/退出；构建产物和浏览器请求头不含分享口令，构建产物不含本机供应商密钥；UI 退出后原后端仍可访问。
- `npm run test:ui`：原本机 UI 的 10 个调查/故障场景及渲染边界、移动布局通过，保留默认 SSE 行为。
- `npm run typecheck`、`npm run lint`、`npm run build`、`git diff --check` 通过；18 个候选文本文件扫描未发现本机 5 项私有凭证。
- 主会话 review 检查了路由/方法/目标限制、到期、请求凭证剥离、共享进程退出、UI 代理与正常 SSE 回归；补上畸形 URL 的 400 响应、退出时等待所创建的 cloudflared 子进程、以及有总期限的公网检查。公网进程生命周期已实测通过。

证据：[本地真实联调](../evidence/shared-ui-local.json)、[截图](../evidence/shared-ui-local.png)、[单元测试](../evidence/shared-backend-unit.json)。

公网连接在用户明确同意 Cloudflare 传输与 Git push 后实际开启。`npm run test:shared-ui -- --public` 经真实 HTTPS 域名完成 8 项检查：主 Why completed，60 个图表点逐一对应实际 Evidence；刷新没有重复 POST；FaceBoom 追问继承窗口且使用新证据；26 次 Run 读取、0 次 SSE、0 个浏览器错误；UI 不加载供应商配置，bundle、浏览器请求头和 localStorage 不含分享口令，UI 退出保留远端后端。

`evidence/shared-backend-lifecycle.json` 记录实际 SIGINT：共享 Node 进程与它创建的 cloudflared 子进程均退出；3199 中继不可访问；连接文件删除口令并写入失效状态；原 3100 Live API 仍健康。之后重新开启分享，给队友使用新文件。维护者本机穿过公网验证成功，队友仍需在自己的设备与网络预跑一次。

公网接入补充了 Vite `changeOrigin: true`，以目标 HTTPS 域名设置 Host。首次新域名解析出现短暂 ENOTFOUND 后恢复，因此启动认证检查允许最多三分钟等待 DNS 生效；未改系统 DNS、未关闭 TLS 校验。连接文件只在公网匿名拒绝与有效口令检查均通过后生成。

公网证据：[真实 HTTPS UI 联调](../evidence/shared-ui-public.json)、[公网截图](../evidence/shared-ui-public.png)、[分享退出](../evidence/shared-backend-lifecycle.json)。

Cloudflared 客户端已从官方发行包下载并核对 SHA-256；安装元数据在 `evidence/shared-cloudflared-install.json`，二进制及私有连接配置均在 Git 忽略的 `.state/`。未调整仓库可见性、未上传赛事材料、未提交供应商凭据。
