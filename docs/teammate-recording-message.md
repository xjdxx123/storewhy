# 可直接转发给队友

下面这段在本次录屏更新 push 到 GitHub 后即可转发；连接文件另行私下发送，不要粘贴文件内容到公开文档。临时连接到期后需换新文件，不要转发旧的固定到期时间。

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

1. 展示 Procrastinate Pro+ 公开教学数据标识及十四天口径，粘贴 [英文问题脚本 A1](recording-questions.md#group-a--july-versus-june-spend-channel-window-and-data-boundary)。展示结论、关键证据和渠道图表。
2. 点 **View source**，展示查询结果、SQL 和 queryId，再关闭详情。
3. 依次粘贴同一脚本的 **A2（FaceBoom）→ A3（7 天）**，每轮完成再继续。FaceBoom 的费用实际下降，别把整体“费用增加”的前提直接套过去。
4. 粘贴 **A4（CTR）**，展示缺少点击/曝光数据时停止回答。有时间可接 A5，展示拆分首次/后续购买收入。
5. 说明：Zetaris 执行统计，Meterless Nightshift 路由 NVIDIA 模型，每个结论能回到查询证据。

[完整英文问题脚本](recording-questions.md) 包含可直接复制的原文、实测结果、耗时和 B/C 两组备用对话，覆盖 5–10 月、三个渠道及 7/14 天。主录屏优先 A 组；十月需要解释随访不足的裁剪。

目标三分钟左右，实际模型可能需要等待，开录前留好余量。`limited` 表示部分解释还缺证据，要如实保留；**View sample replay** 是明确标注的自制样例，不要把它当成 Live Agent。
