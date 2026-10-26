# 可直接转发给队友

下面这段在本次英文版代码 push 到 GitHub 后即可转发；连接文件另行私下发送，不要粘贴文件内容到公开文档。临时连接到期后需换新文件，不要转发旧的固定到期时间。

---

后端我这边已经配好了，你电脑只启动 UI 就能录屏，不用再装 Docker、Zetaris、Nightshift，也不用配置 NVIDIA key 或导入数据。

需要 Node.js 22.12+。先拉最新代码、安装依赖：

```sh
git pull --ff-only
npm ci
```

把我单独发你的 `teammate.env` **改名为 `.env.remote.local`，放在仓库根目录，和 `package.json` 同一层**。别放进 `src`，注意不能多出 `.txt` 后缀，也不要提交这个文件。

以后启动只需：

```sh
npm run demo:ui
```

看到 “只启动 UI，已连接远端 Live 后端” 后，打开 **http://127.0.0.1:5173/**。这个终端在录屏期间保持运行；Ctrl+C 只关闭你电脑的 UI。连接默认两小时有效；如果提示到期或无效，找我要新文件，替换后重启命令。录屏时我会保持后端联网运行。

开录前先完整预跑一次，再点 **New session**。建议按下面顺序演示：

1. 展示 Procrastinate Pro+ 公开教学数据标识和十四天口径，发送预填英文问题：
   “Why did recorded spend increase in July 2019 versus June, while new users’ revenue within 14 days of first visit failed to keep pace?”
2. 展示真实进度、**Conclusion**、**Key evidence** 和渠道图表；点 **View source**，展示实际数值、SQL 和 queryId，再关闭详情。
3. 点 **Focus on FaceBoom**，完成后再点 **Use 7 days**，展示条件、数字与证据会随追问重新计算。
4. 输入 “Why did FaceBoom ad CTR fall in July 2019?”，展示缺少点击/曝光数据时 Agent 会明确说明无法回答。
5. 最后说明：Zetaris 执行统计，Meterless Nightshift 路由 NVIDIA 模型，H-MEM 保存有来源的偏好。如果还有时间，演示 **Save 7-day default** → **New analysis with saved defaults**。

目标三分钟左右，实际模型可能需要等待，开录前留好余量。`limited` 表示部分解释还缺证据，要如实保留；**View sample replay** 是明确标注的自制样例，不要把它当成 Live Agent。
