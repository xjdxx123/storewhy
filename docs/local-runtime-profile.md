# 本机 Zetaris 内存配置

初始本机 Docker 为约 8 GiB、11 vCPU，Zetaris driver 使用 2g Java heap。长时间真实评测中，driver 两次发生 Docker OOM（exit 137），应用返回真实失败。限制后端 SQL 并发仍不足以证明解决了进程内存随负载增长的问题。

单独限制 arena 后，扩大负载仍出现失败，见 zetaris-arena-only-development.json。当前额外应用 [Compose 配置](../infra/zetaris-memory.override.yaml)，将 driver 的 `MALLOC_ARENA_MAX` 设为 2，并将 `ZSPARK_DRIVER_MEM` 调整为 1g。较小 heap 可能增加垃圾回收等待，最终耗时另行实测。这控制 glibc 的 arena 数量，**不是整个进程的内存上限**；设置含义见 [glibc 官方说明](https://sourceware.org/glibc/manual/latest/html_node/Malloc-Tunable-Parameters.html)。没有证明 arena 是唯一根因，因此以实际有限负载结果验收，不承诺长期不会 OOM。

本机还观测到 1g heap 已生效时进程仍有约 5.5 GiB RSS、446 个线程。8 GiB 预算下，1g 配置的 124 条 SQL 数值均匹配，但触及本地资源预算。随后将这台 18 GiB Mac 的 Docker 内存从 8092 MiB 调为 10240 MiB，保存了原设置备份，并恢复原六个运行中容器。实际 Docker 可用内存约 9.7 GiB，记录见 [资源调整](../evidence/docker-memory-adjustment.json)。这是本机资源取舍，其他机器按自身余量测量。

本配置用于已下载到仓库内的本地 Zetaris 平台。等待正在运行的调查结束后，在仓库根目录执行：

```sh
docker compose --project-directory ./zetaris-platform \
  --env-file ./zetaris-platform/.env -p zetaris \
  -f ./zetaris-platform/docker-compose.yml \
  -f ./infra/zetaris-memory.override.yaml config --quiet

docker compose --project-directory ./zetaris-platform \
  --env-file ./zetaris-platform/.env -p zetaris \
  -f ./zetaris-platform/docker-compose.yml \
  -f ./infra/zetaris-memory.override.yaml up -d --no-deps driver
```

第二条命令会重建 driver，使用原有数据卷与私有配置。等待 driver healthy 后执行 `npm run demo:check`。本地平台文件与 `.env` 不提交 Git；Cloud 环境不使用这个 Docker 配置。

连续负载检查：

```sh
npx tsx scripts/soak-zetaris.ts --rounds=2
```

它通过 Zetaris 重新执行 Why 评测中的全部独立分析规格，与已通过独立 CSV 核算的 rows、comparisons、coverage 逐一比较，记录实际 SQL 数量、Docker 工作集和容器重启。driver 占 Docker 内存超过 75% 时停止继续施压。它不是无限时长的稳定性保证；结果会写入 evidence/zetaris-memory-soak.json。

调优过程与最终范围见 [运行优化验证](runtime-verification.md)。Live 大套评测逐项执行；同一应用进程共享两条 SQL 的上限不能约束其他独立进程或手工查询。
