# 队友只启动 UI，连接已经配置好的后端

适用于队友和后端维护者不在同一网络的录屏。队友不需要安装 Docker、Zetaris 或 Nightshift，也不需要 NVIDIA 账号、业务数据或供应商 key。所有分析仍由维护者电脑上的真实后端、Zetaris 和 Nightshift/NVIDIA 完成。

连接方式：队友浏览器 → 队友本机 UI 代理 → Cloudflare 临时 HTTPS 隧道 → 带独立口令的中继 → 维护者现有 API。分析问题、统计结果与证据会经过 Cloudflare；启用前由维护者确认允许此第三方传输。隧道不能直接访问 Zetaris、Nightshift 或数据库端口。

## 维护者准备一次分享

确认已配置的 Live API 在 `http://127.0.0.1:3100` 运行，且 Zetaris/Nightshift 可用。若需要从头启动应用，可先运行 `npm run demo`；该命令也会提供维护者本机 UI。已运行时不用重复启动。

本机还需要官方 `cloudflared` 客户端。macOS 可使用 `brew install cloudflared`；其他系统按 [Cloudflare 官方安装说明](https://developers.cloudflare.com/tunnel/downloads/) 安装。脚本优先使用 `CLOUDFLARED_BIN` 指定的路径，其次使用 `.state/bin/cloudflared`，最后使用系统 PATH。本次维护者电脑已在 `.state/bin` 安装并核对官方二进制 hash；该程序不提交 Git。

在另一个 Terminal 运行：

```sh
npm run share:backend
```

脚本检查现有 Live API，通过 `127.0.0.1:3199` 建立带随机口令的中继，再启动临时 HTTPS 隧道。只有匿名请求被拒绝、带口令的公网请求能取回正确版本的 Live 健康状态后，才生成连接文件：

```text
.state/share/teammate.env
```

该文件包含临时地址、独立访问口令与到期时间，权限为 `0600`，不要提交 Git。**仅私下将整个文件交给需要录屏的队友。** 文件不包含 Zetaris API key、Nightshift token、NVIDIA key 或数据库密码。连接口令允许使用整个 StoreWhy API，包括创建调查、查询证据和修改会话；应只交给可信队友。

分享默认持续 **120 分钟**，到期自动关闭。维护者需要保持联网、电脑唤醒、原后端/供应商服务及分享进程运行；必要时可另开 Terminal 使用 macOS 自带 `caffeinate -i`，完成后 Ctrl+C。关闭分享 Terminal 或按 Ctrl+C 会结束该隧道、使本次连接文件失效，原 API 与外部平台继续运行。重开分享会更换地址与口令，须重新发送文件。

## 队友首次准备

需要 Git、Node.js **22.12+**，GitHub 账号已能访问仓库。在本机运行：

```sh
git clone https://github.com/xjdxx123/storewhy.git
cd storewhy
npm ci
```

已有 clone 先执行 `git pull --ff-only`，然后 `npm ci`。在仓库根目录，把维护者发来的 `teammate.env` 保存/改名为 **`.env.remote.local`**。不要保存成 `.env.remote.local.txt`，也不要复制到 React 源码。此文件默认被 Git 忽略。

每次录屏只需：

```sh
npm run demo:ui
```

看到“只启动 UI，已连接远端 Live 后端”，打开 **http://127.0.0.1:5173/**。这个命令只检查远端健康状态、构建并提供本机 UI，不启动 API 或任何平台。无需创建 `.env.local`，也无需运行 `data:prepare/load/register`。连接口令由本机 Node/Vite 代理添加，不进入 React bundle、localStorage 或浏览器请求头。

录制前预跑一次主 Why。录屏顺序见 [录屏指南](recording.md#三分钟录制顺序)。队友 Ctrl+C 只关闭自己的 UI；维护者的后端、分享和其他队友 UI 不受影响。

可选变量：`STOREWHY_REMOTE_CONFIG` 指定连接文件；`STOREWHY_UI_PORT` 改本机 UI 端口；`STOREWHY_HTTP_URL` 在维护者侧指定现有 API 根地址。UI 端口变化会改变浏览器 origin，需要新建会话。根目录私有 `.env.local` 不参与 `demo:ui` 的配置加载。

## 进度与连接限制

[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) 使用随机域名、没有可用性保证，目前不支持 SSE，最多 200 个同时处理中的请求。`demo:ui` 因此每两秒读取同一个 Run，展示后端的真实阶段，不订阅 SSE，也不自动重发提问。刷新继续恢复原调查，不重复创建。普通本地 UI 的 SSE 行为保留。

分享中继在请求转发前校验口令与到期时间，只放行 `/healthz`、`/api/v1/` 的 GET/POST/OPTIONS。它不提供任意目标代理，原 API 仍只监听本机。口令会随每次分享更换；这是一种短时团队录屏连接，不提供用户隔离、账户管理或持续部署。

- “访问口令无效/分享结束”：让维护者重开分享，换新文件后重新运行 `npm run demo:ui`。
- 启动时无法连接：确认维护者的分享已就绪、双方联网、文件没有过期；查看维护者私有 `.state/share/cloudflared.log`。
- UI 已打开但调查失败：先看页面错误和维护者供应商连接状态；不能用旧结果或 fixture 冒充 Live。
- 5173 被占用：先正常停止自己的旧 UI，或指定另一个 UI 端口。本命令不自动 kill 其他程序。
- 3199 被占用：维护者先正常停止旧分享；脚本不杀占用端口的程序。
- 隧道断开或电脑睡眠：恢复网络/唤醒后重开分享并更新文件；录制前重新预跑。已有调查可用页面“恢复”读取，不必重发。

## 验证

```sh
npm run test:shared-ui
npm run test:shared-ui -- --public
```

第一条仅使用本机受保护的中继连接现有 Live API，验证真实 Why、追问、刷新、图表证据、UI 独立启动/退出、无 SSE 和浏览器 bundle 不含口令；它不证明外网可达。第二条在分享已获授权并启动后，读取 `.state/share/teammate.env`，用真实公网 HTTPS 地址完成同样的检查。两者需要已运行的 Live API 和本机 Chrome，结果分别写入 `evidence/shared-ui-local.json` / `shared-ui-public.json`，不记录连接口令。

维护者的 `share:backend` 自带公网匿名/认证健康检查；队友仍需在自己的网络预跑，维护者本机穿过公网隧道的验证不能代替队友设备验证。
