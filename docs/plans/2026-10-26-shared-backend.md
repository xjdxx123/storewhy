# 跨网络连接现有后端录屏

- [x] 增加 `demo:ui` 和私有连接文件；访问口令只进入 Vite 服务器代理，不进入浏览器 bundle。无需供应商凭证、数据或启动本机 API。
- [x] 实现独立口令保护的短时 API 中继与 Cloudflare 临时 HTTPS 隧道入口。无口令/错口令不触达后端，仅允许 StoreWhy API；结束分享不停止原后端。默认两小时到期。
- [x] 兼容 Quick Tunnels 不支持 SSE：远端 UI 轮询同一 Run；经本机受保护中继完成真实 Why、追问、中途刷新、60 个图表点证据绑定、独立 UI 退出与 bundle 凭证检查。该验证不证明外网可达。
- [x] 用户明确授权 Cloudflare 传输与 Git push 后开启隧道；真实公网端点匿名/认证与 UI 检查全部通过。实际 SIGINT 验证分享/子进程退出、中继关闭、连接文件失效，原后端继续在线。
- [x] 更新共享后端/录屏/备用 UI/README 文档，增加可复用的 `test:shared-ui` 和 `--public` 检查入口。
- [x] 最终 tests/lint/typecheck/build 与主会话 review 通过，代码本地提交/合并；用户已明确授权本次 push。

## 已完成的验证

`evidence/shared-ui-local.json`：8 项检查通过，真实 Zetaris/Nightshift/NVIDIA，`publicTunnelVerified: false`。主 Why completed，60 个图表点逐一对应 Evidence；FaceBoom 追问承接口径并重新生成证据；实际浏览器没有 SSE 请求、访问口令或 console error。UI 进程使用独立连接文件，供应商环境变量为空，退出后原共享后端仍可访问。

`evidence/shared-backend-unit.json`：154/154 通过。`npm run test:ui`：原本机 SSE/轮询、刷新、取消、缺字段、模型离线、图表边界与移动布局回归通过。

`evidence/shared-ui-public.json`：真实公网 HTTPS 联调 8 项通过，主 Why completed，60 个图表点均对应实际 Evidence，FaceBoom 追问通过，26 次 Run 读取、0 次 SSE、0 个浏览器错误。`evidence/shared-backend-lifecycle.json`：真实 SIGINT 后进程、子进程、中继和私有连接文件的退出/失效均验证通过，原 API 仍在线。
