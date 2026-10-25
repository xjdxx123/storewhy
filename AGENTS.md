# StoreWhy 项目规则

- 后端使用 TypeScript、Fastify；共享 API/Zod/types/client 在 packages/contracts。React UI 由队友负责，未明确要求时不改 apps/web。
- 常规检查：npm test、npm run lint、npm run typecheck、npm run build。修改指标或 SQL 时追加 npm run test:live；修改意图/Agent 时追加相关真实模型评测。
- Live 的业务统计必须经 Zetaris；直接 PostgreSQL 仅供导入。fixture 明确标注为自制样例，不可在 Live 失败时静默回退。
- 金额保持源精度后汇总舍入；独立参考在 scripts/reference-metrics.py。费用只支持渠道与日期，禁止分摊到设备/国家。
- 时期 end 不包含结束日。cohort 支持七天/十四天完整随访，与 calendar 不混用；未成熟用户和费用同步裁剪。
- 模型选择调查路径、补查和证据 ID。最终数字与比较语句由 observations 按实际结果生成，不让模型重写事实。
- 追问继承显式 Context，修订后重新查询。H-MEM 只召回来源与 scope 匹配且未被替代/标错的默认值。
- 不提交 .env.local、.state、原始 CSV、平台下载或供应商参考 checkout。H-MEM 保留上游 LICENSE 与 UPSTREAM。
- 按用户协议只做本地 commit/merge，未经明确要求不 push、不调整远程可见性、不发布或提交赛事材料。
