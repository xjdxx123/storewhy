import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  type Run,
  type RunEvent,
  type Conversation,
  type Evidence,
  type Fact,
  type ContextPatch,
  type InvestigationContext,
  type ExpectedContext,
} from "@storewhy/contracts";
import { type ModelGateway } from "../integrations/nightshift.ts";
import { Analytics, specKey } from "../analytics/service.ts";
import { catalog, LABELS, segmentLabel } from "../analytics/catalog.ts";
import { validateSpec } from "../analytics/compiler.ts";
import { DiskStore, initialContext, patchSpec } from "../context/store.ts";
import { MemoryManager } from "../memory/manager.ts";
import { AppError, cleanError } from "../config.ts";
import {
  intentSchema,
  draftSchema,
  reviewSchema,
  toolPatchSchema,
} from "./schemas.ts";
import { z } from "zod";
import {
  observationsFor,
  validateSelection,
} from "../analytics/observations.ts";
import { explanationsFor } from "../analytics/explanations.ts";
import { presentAnswer } from "../analytics/report.ts";
import { chartsFor } from "../analytics/charts.ts";
import {
  explicitConstraints,
  isScopeOnly,
  protectScopePatch,
  needsDateClarification,
  isWhyQuestion,
} from "../context/constraints.ts";
const terminal = (s: Run["status"]) => s !== "queued" && s !== "running";
export function factsFor(evidence: Evidence[]): Fact[] {
  return evidence.flatMap((e, ei) =>
    e.rows.flatMap((row, ri) =>
      Object.entries(row.values).map(([metric, value]) => ({
        id: `f-${ei}-${ri}-${metric}`,
        evidenceId: e.id,
        rowIndex: ri,
        metric: metric as Fact["metric"],
        value: value ?? null,
        label: `${row.period}${row.bucket ? " / " + row.bucket : ""} / ${segmentLabel(row.dimensions, e.spec.filters)} / ${e.spec.mode === "cohort" ? e.spec.windowDays + "天" : "自然时期"} / ${LABELS[metric as Fact["metric"]]}`,
      })),
    ),
  );
}

function restrictPatch(
  base: InvestigationContext["spec"],
  patch: ContextPatch,
) {
  for (const key of ["channels", "devices", "regions"] as const) {
    const constrained = base.filters[key],
      requested = patch.filters?.[key];
    if (
      constrained.length &&
      requested &&
      (!requested.length || requested.some((v) => !constrained.includes(v)))
    )
      throw new AppError("SCOPE_EXPANSION", "自动调查不能扩大用户明确筛选范围");
  }
}
export class Engine {
  readonly events = new EventEmitter();
  private active = new Set<string>();
  private controllers = new Map<string, AbortController>();
  private tasks = new Set<Promise<void>>();
  constructor(
    readonly analytics: Analytics,
    readonly model: ModelGateway,
    readonly store: DiskStore,
    readonly memory: MemoryManager,
  ) {}
  createRun(
    conversationId: string,
    input: {
      message: string;
      patch?: ContextPatch;
      newInvestigation?: boolean;
      expectedContext?: ExpectedContext;
      taskKind?: "query" | "why" | "followup";
    },
  ): Run {
    if (this.active.has(conversationId))
      throw new AppError(
        "CONVERSATION_BUSY",
        "当前会话仍在调查，请等待或取消",
        409,
      );
    if (this.active.size >= 2)
      throw new AppError("CAPACITY", "当前已有两个调查运行，请稍后重试", 429);
    const c = this.store.get<Conversation>("conversations", conversationId);
    if (input.expectedContext) {
      const expected = input.expectedContext;
      if (
        Object.entries(expected).some(
          ([key, value]) =>
            c.context[key as keyof InvestigationContext] !== value,
        ) ||
        expected.datasetVersion !== this.analytics.datasetVersion
      )
        throw new AppError(
          "STALE_CONTEXT",
          "分析条件已更新，请使用最新回答中的推荐追问。",
          409,
        );
    }
    const id = randomUUID();
    const run: Run = {
      id,
      conversationId,
      investigationId: c.context.investigationId,
      status: "queued",
      question: input.message,
      context: structuredClone(c.context),
      events: [],
      evidenceIds: [],
      modelTraces: [],
      createdAt: new Date().toISOString(),
    };
    this.store.put("runs", id, run);
    c.runIds.push(id);
    this.store.put("conversations", conversationId, c);
    this.active.add(conversationId);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    queueMicrotask(() => {
      const task = this.perform(
        run,
        input,
        AbortSignal.any([controller.signal, AbortSignal.timeout(360000)]),
      ).finally(() => {
        this.active.delete(conversationId);
        this.controllers.delete(id);
        this.tasks.delete(task);
      });
      this.tasks.add(task);
    });
    return structuredClone(run);
  }
  recoverInterrupted() {
    for (const run of this.store.list<Run>("runs"))
      if (!terminal(run.status)) {
        run.status = "failed";
        run.finishedAt = new Date().toISOString();
        run.message = "服务重启中断了上轮调查，请重新提问。";
        this.event(run, "error", run.message, { code: "SERVER_RESTARTED" });
      }
  }
  async shutdown() {
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([...this.tasks]);
  }
  private save(run: Run) {
    this.store.put("runs", run.id, run);
  }
  private event(
    run: Run,
    type: RunEvent["type"],
    message: string,
    data?: unknown,
  ) {
    const e: RunEvent = {
      seq: run.events.length + 1,
      type,
      at: new Date().toISOString(),
      message,
      ...(data !== undefined ? { data } : {}),
    };
    run.events.push(e);
    this.save(run);
    this.events.emit(run.id, e);
  }
  cancel(id: string) {
    const run = this.store.get<Run>("runs", id);
    if (terminal(run.status)) return run;
    this.controllers.get(id)?.abort();
    return { ...run, cancellationRequested: true };
  }
  private async perform(
    run: Run,
    input: {
      message: string;
      patch?: ContextPatch;
      newInvestigation?: boolean;
      expectedContext?: ExpectedContext;
      taskKind?: "query" | "why" | "followup";
    },
    signal: AbortSignal,
  ) {
    try {
      run.status = "running";
      this.event(run, "run_started", "开始检查问题与数据范围");
      const c = this.store.get<Conversation>(
        "conversations",
        run.conversationId,
      );
      const preference = this.memory.recall(c.id);
      if (preference)
        this.event(
          run,
          "memory_recalled",
          "已检索有来源的默认口径",
          preference,
        );
      if (
        input.newInvestigation ||
        c.context.datasetVersion !== this.analytics.datasetVersion
      ) {
        c.context = initialContext(
          c.id,
          this.analytics.datasetVersion,
          preference?.windowDays ?? 14,
        );
        run.context = structuredClone(c.context);
        run.investigationId = c.context.investigationId;
        this.store.put("conversations", c.id, c);
      }
      if (needsDateClarification(input.message, input.patch)) {
        run.status = "needs_clarification";
        run.message =
          "当前数据仅覆盖二零一九年五月至十月。请明确样例中的日期，不能将现实的相对日期替换成样例月份。";
        this.event(run, "clarification", run.message);
        return;
      }
      const intent = input.patch
        ? { kind: input.taskKind ?? ("followup" as const), patch: input.patch }
        : await this.model.structured(
            "investigator.intent",
            intentSchema,
            [
              {
                role: "system",
                content: `你是增长运营调查员。只提取用户明确改变的条件，未提及字段不要放进 patch。followup 继承当前目标，只有新的明确查询才选 query。why 是解释问题。支持 calendar/cohort，归属为首次观测。趋势用 mode:calendar、timeGrain:day/week/month，统计汇总用 timeGrain:null。月份收入趋势用 calendar all。只有用户明确要求趋势或按时间分桶才设 timeGrain；自然月单期汇总应设 timeGrain:null。一次最多两个期间，结果最多两百行；全渠道每日趋势需要缩小范围。日期 end 是不包含的结束日。用户说七月指样例年份须在有明确样例上下文时使用二零一九年。现实今年/本月超出范围必须 clarify。全部用户或包含organic表示 audience:all，不是 channels:[organic]；只有“仅organic”才筛选该渠道。地区只能使用catalog的UK等原值。首周为七天，两周为十四天。日期连续范围要覆盖中间所有日期，不要只比较范围端点。人群付费表现至少查payer_rate。reset 只用于要求清空分析。没有曝光/点击/预算/素材/商品/结账/退款/利润/因果增量，相关请求返回 unsupported。设备/国家没有费用；设备用户行为可查。收入与费用比较优先 cohort paid；整体购买月收入用 calendar all。清除筛选写空数组。普通自然语言描述不能改变不相关条件。未修改的 optional patch 字段直接省略，不要填 null；windowDays 只能是 7 或 14，即使 calendar 也不能填 null。\nCATALOG:${JSON.stringify(catalog(this.analytics.datasetVersion, this.analytics.backend.kind))}`,
              },
              {
                role: "user",
                content: JSON.stringify({
                  currentContext: c.context,
                  currentQuestion: input.message,
                }),
              },
            ],
            run.modelTraces,
            signal,
          );
      if (
        (intent.kind === "query" || intent.kind === "why") &&
        !input.taskKind &&
        c.context.lastQuestion &&
        isScopeOnly(input.message) &&
        !input.newInvestigation
      )
        intent.kind = "followup";
      if (
        (intent.kind === "query" || intent.kind === "followup") &&
        isWhyQuestion(input.message)
      )
        intent.kind = "why";
      if (intent.kind === "reset") {
        c.context = initialContext(
          c.id,
          this.analytics.datasetVersion,
          preference?.windowDays ?? 14,
        );
        run.context = structuredClone(c.context);
        run.investigationId = c.context.investigationId;
        this.store.put("conversations", c.id, c);
        run.status = "needs_clarification";
        run.message = "已开始新分析。请告诉我想检查的指标与时期。";
        this.event(run, "clarification", run.message);
        return;
      }
      if (intent.kind === "clarify" || intent.kind === "unsupported") {
        run.status =
          intent.kind === "clarify" ? "needs_clarification" : "unsupported";
        run.message =
          intent.message ?? "当前数据不足以回答，请明确时期、指标或可用范围。";
        this.event(run, "clarification", run.message);
        return;
      }
      const candidate = patchSpec(
        c.context.spec,
        input.patch
          ? intent.patch
          : c.context.lastQuestion && isScopeOnly(input.message)
            ? protectScopePatch(
                input.message,
                explicitConstraints(input.message, intent.patch),
              )
            : explicitConstraints(input.message, intent.patch),
      );
      const spec = validateSpec(candidate);
      const taskKind =
        intent.kind === "followup"
          ? (c.context.taskKind ?? "why")
          : intent.kind;
      c.context = {
        ...c.context,
        spec,
        revision: c.context.revision + 1,
        evidenceIds: [],
        lastQuestion: input.message,
        taskKind,
        objective:
          intent.kind === "followup"
            ? c.context.objective || input.message
            : input.message,
      };
      run.context = structuredClone(c.context);
      run.investigationId = c.context.investigationId;
      this.store.put("conversations", c.id, c);
      this.event(run, "scope_updated", "已确定本轮条件，相关数字将重新查询", {
        context: run.context,
      });
      const evidence: Evidence[] = [];
      const seen = new Set<string>();
      let queries = 0;
      const execute = async (patch: ContextPatch) => {
        restrictPatch(spec, patch);
        const next = validateSpec(patchSpec(spec, patch));
        const key = specKey(next);
        if (
          seen.has(key) ||
          evidence.some((existing) => {
            const { metrics: prior, ...priorScope } = existing.spec;
            const { metrics: requested, ...requestedScope } = next;
            return (
              JSON.stringify(priorScope) === JSON.stringify(requestedScope) &&
              requested.every((metric) => prior.includes(metric))
            );
          })
        )
          return false;
        const estimated = next.periods.length * 2;
        if (queries + estimated > 8) return false;
        this.event(
          run,
          "query_started",
          "正在通过 " + this.analytics.backend.kind + " 查询",
          { spec: next },
        );
        const e = await this.analytics.query(next, signal);
        queries += e.queryIds.length;
        seen.add(key);
        evidence.push(e);
        run.evidenceIds.push(e.id);
        run.context.evidenceIds.push(e.id);
        this.store.put("evidence", e.id, e);
        this.event(run, "query_completed", "查询完成", {
          evidenceId: e.id,
          rows: e.rows.length,
          durationMs: e.durationMs,
          coverage: e.coverage,
        });
        return true;
      };
      await execute({});
      const observed = evidence[0]?.rows.some((r) =>
        Object.values(r.values).some((v) => v !== null && v !== 0),
      );
      if (!observed) {
        run.status = "no_data";
        run.message = "在所选数据范围内没有可用记录或可计算指标。";
        this.event(run, "clarification", run.message);
        return;
      }
      const history = c.runIds
        .slice(-11)
        .filter((id) => id !== run.id)
        .map((id) => this.store.get<Run>("runs", id))
        .filter(
          (prior) =>
            prior.investigationId === run.investigationId &&
            terminal(prior.status),
        )
        .flatMap((prior) => prior.evidenceIds)
        .map((id) => this.store.get<Evidence>("evidence", id));
      if (taskKind === "query") {
        run.answer = presentAnswer({
          context: run.context,
          evidence,
          facts: factsFor(evidence),
          ready: true,
          history,
        });
        run.status = "completed";
      } else {
        let lastDraft: z.infer<typeof draftSchema> | undefined;
        let feedback = "";
        let ready = false;
        for (let round = 0; round < 3; round++) {
          signal.throwIfAborted();
          const facts = factsFor(evidence);
          const observations = observationsFor(evidence, facts).sort(
            (a, b) =>
              evidence.findIndex((e) => e.id === b.evidenceId) -
              evidence.findIndex((e) => e.id === a.evidenceId),
          );
          const evidenceBrief = evidence.map((e) => ({
            id: e.id,
            scope: e.spec,
            coverage: e.coverage,
            rows: e.rows,
            notes: e.notes,
          }));
          const availableAnalyses = evidence.map((e) => ({
            groupBy: e.spec.groupBy,
            metrics: e.spec.metrics,
            filters: e.spec.filters,
          }));
          const draft = await this.model.structured(
            "investigator.explain",
            draftSchema,
            [
              {
                role: "system",
                content:
                  "你是 Investigator。从 observations 选择最能解释用户问题的观测ID，并选择待检验的 hypothesis。headlineObservationId 必须是 observationIds 内最直接回答问题的一条，优先选择具体渠道或人群的关键变化；不要用审查状态充当结论。数字与事实句由系统按所选证据生成，你不能重写数字或发明证据。如果已执行补查，必须选取最新补查中的相关观测，优先展示新增拆分的费用/收入关联，不能只重复最初的整体结果。若现有证据不能区分解释，提出 suggestedQuery，只能改metrics/groupBy/filters，不能扩大用户筛选。已有渠道拆分不能重复。收入与费用的变化只能解释观测构成，不能证明广告因果增量。根据 reviewFeedback 改选证据或补查。",
              },
              {
                role: "user",
                content: JSON.stringify({
                  question: c.context.objective,
                  scope: spec,
                  followupQuestion: input.message,
                  availableAnalyses,
                  observations,
                  evidence: evidenceBrief,
                  reviewFeedback: feedback,
                }),
              },
            ],
            run.modelTraces,
            signal,
          );
          try {
            validateSelection(draft.observationIds, observations);
            if (
              draft.headlineObservationId &&
              !draft.observationIds.includes(draft.headlineObservationId)
            )
              throw new AppError(
                "UNBOUND_HEADLINE",
                "结论必须引用已选择的观测。",
                503,
              );
            if (evidence.length > 1) {
              const newest = observations.filter(
                (o) => o.evidenceId === evidence.at(-1)!.id,
              );
              const required =
                newest.find((o) => o.kind === "joint") ?? newest[0];
              if (
                required &&
                !draft.observationIds.some((id) =>
                  newest.some((o) => o.id === id),
                )
              )
                draft.observationIds = [
                  required.id,
                  ...draft.observationIds,
                ].slice(0, 6);
            }
          } catch (error) {
            feedback = cleanError(error);
            if (round === 2) {
              if (!lastDraft) throw error;
              break;
            }
            continue;
          }
          lastDraft = draft;
          this.event(run, "hypothesis", "已形成待审查的解释", {
            selectedObservations: validateSelection(
              draft.observationIds,
              observations,
            ),
            hypothesis: draft.hypothesis,
            suggestedQuery: draft.suggestedQuery,
          });
          const review = await this.model.structured(
            "reviewer",
            reviewSchema,
            [
              {
                role: "system",
                content:
                  "你是独立 Reviewer，检查证据是否回答问题，金额、分母、时期是否一致。先看 scope.mode：calendar 按自然时期活动统计，windowDays 无效；cohort 按首访批次观察完整H天，不能混入老用户自然月收入。首次/后续购买不是新客/老客。完整随访不能称为随访不足；未标币种不妨碍同单位比较。只看真实 evidence、observations 和 availableAnalyses，不相信草稿的无证据限制。整体渠道费用或增长仅有汇总时要求渠道拆分；已查过的指标和拆分不能重复。发现可补的具体缺口才 needs_query，query 只改 metrics/groupBy/filters，不能扩大用户筛选。数据缺失或因果原因无法由记录证明时 limited。充分时 ready；不必穷尽所有分组。中文简述理由。",
              },
              {
                role: "user",
                content: JSON.stringify({
                  question: c.context.objective,
                  scope: spec,
                  followupQuestion: input.message,
                  draft,
                  selectedObservations: validateSelection(
                    draft.observationIds,
                    observations,
                  ),
                  availableAnalyses,
                  observations,
                  evidence: evidenceBrief,
                }),
              },
            ],
            run.modelTraces,
            signal,
          );
          feedback = review.reason + " " + review.issues.join(" ");
          this.event(
            run,
            "review_completed",
            review.decision === "ready"
              ? "证据审查完成"
              : review.decision === "needs_query"
                ? "审查发现证据缺口，准备补查"
                : "当前证据仍有无法验证的解释",
            {
              reason: review.reason,
              decision: review.decision,
              issues: review.issues,
              query: review.query,
            },
          );
          if (review.decision === "ready") {
            ready = explanationsFor(evidence, facts).some(
              (check) =>
                check.kind !== "maturity" &&
                ["supported", "contradicted"].includes(check.status),
            );
            break;
          }
          if (review.decision === "limited") break;
          const patch = review.query ?? draft.suggestedQuery;
          if (!patch || round === 2) break;
          try {
            const accepted = await execute(toolPatchSchema.parse(patch));
            if (!accepted) {
              feedback +=
                " 本查询已执行或超出预算，请依据 availableAnalyses 中已有证据审查，不要重复索取。";
              continue;
            }
          } catch (error) {
            if (!(error instanceof AppError) || error.statusCode >= 500)
              throw error;
            feedback += " 无法执行该拆分：" + error.message;
          }
        }
        if (!lastDraft)
          throw new AppError(
            "UNVALIDATED_ANSWER",
            "没有通过事实引用校验的解释",
            503,
          );
        const allFacts = factsFor(evidence);
        const selected = validateSelection(
          lastDraft.observationIds,
          observationsFor(evidence, allFacts),
        );
        run.answer = presentAnswer({
          context: run.context,
          evidence,
          facts: allFacts,
          selected,
          headlineObservationId: lastDraft.headlineObservationId,
          history,
          ready,
        });
        run.status = ready ? "completed" : "limited";
      }
      if (run.answer) {
        const presentation = chartsFor(evidence);
        run.answer.charts = presentation.charts;
        run.answer.chartNotes = presentation.notes;
      }
      c.context.evidenceIds = [...run.evidenceIds];
      this.store.put("conversations", c.id, c);
      run.finishedAt = new Date().toISOString();
      this.save(run);
      this.memory.summarize(run);
      this.event(run, "answer_ready", "本轮调查完成", { status: run.status });
    } catch (error) {
      const own = this.controllers.get(run.id)?.signal.aborted;
      run.status = own
        ? "cancelled"
        : error instanceof AppError && error.statusCode < 500
          ? "unsupported"
          : "failed";
      run.message = cleanError(error);
      this.event(run, own ? "cancelled" : "error", run.message, {
        code: error instanceof AppError ? error.code : "RUNTIME_ERROR",
      });
    } finally {
      run.finishedAt ??= new Date().toISOString();
      this.save(run);
    }
  }
}
export { terminal };
