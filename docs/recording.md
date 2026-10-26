# 队友电脑上的启动与录屏

## 日常只需一条命令

首次配置完成、Zetaris 和 Nightshift 已启动后，在仓库根目录运行：

```sh
npm run demo
```

看到“录屏服务已就绪”，打开 **http://127.0.0.1:5173/**。该命令在同一进程中启动 Live API、构建并提供备用 React UI、配置 API/SSE 代理。Ctrl+C 同时关闭本次启动的两个服务，不停止外部 Zetaris、Nightshift、数据库，也不关闭别的已运行进程。

启动前检查私有配置与端口；启动后检查 Zetaris SQL 连接、Nightshift 中指定模型的发现，以及六月/七月主展示范围的实际查询。模型发现不等同于 NVIDIA 推理已成功，开始录制前仍需在页面预跑一次完整 Why。任一启动检查失败会停止并清理本次服务，不切换 fixture。

## 新电脑的首次准备

**git pull 不会复制原电脑的 Docker 容器、私有 .env.local、原始 CSV、已登记数据、Nightshift/NVIDIA 配置。** 队友自己的电脑必须先完成下面的准备，或由团队提供他可访问的、已配置好的后端数据/模型服务地址。`localhost` 永远指当前电脑，不能直接填另一位队员电脑上的 localhost。

1. 安装 Node.js **22.12+**、Git；本地运行 Zetaris 时安装并启动 Docker Desktop。
2. 拉取项目并安装依赖：

```sh
git clone https://github.com/xjdxx123/storewhy.git
cd storewhy
npm ci
cp .env.example .env.local
```

仓库为 private 时，需要队友自己的 GitHub 账号已有访问权。已有 clone 使用 `git pull --ff-only`，不要覆盖已有 `.env.local`。

3. 按 Hackathon Setup Guide 安装并启动 **Zetaris** 和 **Meterless Nightshift**。平台 ZIP 不在本项目中；Zetaris 通过活动/Cloud 页面取得本地安装包与 registry 登录信息。Nightshift 使用活动指南提供的安装方式，在 Providers 连接 NVIDIA；API key 保存于 Nightshift。官方入口：[Zetaris](https://www.zetaris.com/cloud)、[Nightshift Mac](https://www.meterless.ai/mac.html)、[Nightshift Windows](https://www.meterless.ai/windows.html)。活动安装版本以 Setup Guide 为准。
4. 在本机私有 `.env.local` 填写：

| 变量                                            | 从哪里取得                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| ZETARIS_REST_URL / ZETARIS_ORG_ID               | 此电脑的 Zetaris API 地址与组织；保留 `/api/v1.0`，不要填 UI 地址                   |
| ZETARIS_API_KEY                                 | 此 Zetaris 实例的 Management → API Tokens                                           |
| METERLESS_BASE_URL                              | 此电脑 Nightshift Console 的 Runtime URL，通常以 `/v1` 结束                         |
| METERLESS_RUNTIME_TOKEN                         | 同一 Nightshift Runtime 的 token                                                    |
| METERLESS_MODEL                                 | 该 Runtime `/models` 里存在的模型；当前验证的是 `nvidia/nemotron-3-ultra-550b-a55b` |
| STOREWHY_DB_PASSWORD / STOREWHY_READER_PASSWORD | 两个分别生成的本地数据库密码，至少 20 位，仅字母、数字、下划线或连字符              |
| ZETARIS_DOCKER_NETWORK                          | Zetaris driver 所在 Docker 网络；原电脑为 `zetaris_default`，新电脑按实际填写       |

凭证配置在录屏前完成，不拍摄配置内容，也不把此文件提交 Git。

5. 将教学数据导入本机独立数据服务，并登记到 Zetaris（首次执行）：

```sh
npm run data:prepare
docker compose --env-file .env.local -f infra/compose.yaml up -d
npm run data:load
npm run data:register
```

执行导入前等待 storewhy-data healthy。上述路径适用于本地 Zetaris 与 storewhy-data 位于同一 Docker 网络的方式；若使用团队远程 Zetaris，需要先在远程登记同一数据集，不能直接让远程 driver 连接本机的 `storewhy-data` 主机名。数据来源、固定 hash 与导入口径见 [README](../README.md#live-数据与模型)。不要在录制期间重复导入数据。

首次准备完成后，每次打开 Docker/Zetaris、Nightshift，再运行 `npm run demo` 即可启动本应用，无需两个 Terminal 分别起 API/UI。本命令不自动下载供应商平台、申请账号、获取授权或导入/替换业务数据。

## 三分钟录制顺序

1. 开始前先手动跑通一次主 Why；检查网络、模型响应和界面没有错误。录制时点击“新会话”，展示公开教学数据标识及十四天口径。
2. 发送预填问题：“为什么2019年7月比6月费用增加，新用户首访后14天收入却没有同步增长？”展示真实进度、一句结论与渠道图表。
3. 点击“查看依据”，展示实际数值、SQL 和 queryId，然后关闭详情。
4. 点击“只看 FaceBoom”，再“改为 7 天”，展示筛选、窗口、数字与证据随追问更新。limited 表示解释有缺口，保留该状态。
5. 输入“为什么2019年7月FaceBoom的广告CTR下降？”，展示缺少点击/曝光数据时停止。
6. 简短说明：Zetaris 执行统计；Nightshift 路由 NVIDIA 模型；H-MEM 保留有来源的偏好。若时间允许，保存七天默认窗口，再“按默认条件新分析”。

具体文案见 [Demo 脚本](demo-script.md)。等待时间取决于当前外部服务；开录前预跑并预留余量。自制样例回放可用于检查页面，但必须按界面标识说明没有运行在线 Agent。

## 常见启动问题

- 缺少 token：填本机 `.env.local`，不要从聊天复制占位值。
- Zetaris / Nightshift 不在线：先启动外部服务，确认 Runtime 地址、组织、授权和模型名正确。
- 主展示范围查询失败：检查数据导入、登记、Docker 网络与 driver 健康；不能只看登录页面能否打开。
- 3100 或 5173 被占用：若已经在运行，可直接打开页面；否则正常停止原服务后再启动。本命令不会自动 kill 占用端口的程序。
- 自定义端口：设置 `STOREWHY_DEMO_API_PORT` 与 `STOREWHY_DEMO_UI_PORT` 后运行同一命令；UI 代理会跟随所选 API 端口。Windows PowerShell 用 `$env:变量="值"`，macOS/Linux 可用前缀环境变量。并行测试需另外设置 `STOREWHY_STATE_DIR`，不要让多个后端写同一状态目录。

自动验证：`npm run test:demo`（需要已配置的真实数据/模型服务和 Chrome，实际调用模型），覆盖缺配置、错误端口、端口冲突、真实启动、UI 中 Why、活动调查中 Ctrl+C 与端口释放。
