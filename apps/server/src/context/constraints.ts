import type { ContextPatch } from "@storewhy/contracts";
import { CHANNELS } from "../analytics/catalog.ts";
// These guards protect explicit user constraints; the model still chooses the investigation.
export function needsDateClarification(text: string, patch?: ContextPatch) {
  const years = text.match(/\b20\d{2}\b|20\d{2}(?=年)/g) ?? [];
  if (!patch?.periods && years.some((year) => year !== "2019")) return true;
  return (
    !patch?.periods &&
    !/2019|二零一九/.test(text) &&
    /今年|本月|这个月|上个月|今天|昨天|this month|last month|this year|today|yesterday/i.test(
      text,
    )
  );
}
export function explicitConstraints(
  text: string,
  patch: ContextPatch,
): ContextPatch {
  const next = structuredClone(patch);
  if (next.mode === "cohort") next.timeGrain = null;
  const seven =
    /(?:7|七)\s*天|(?:首访后|窗口|观察)(?:7|七)\s*日|首周|第一周|一周|1\s*周|first week|seven days/i.test(
      text,
    );
  const fourteen =
    /(?:14|十四)\s*天|(?:首访后|窗口|观察)(?:14|十四)\s*日|两周|二周|2\s*周|two weeks|fourteen days/i.test(
      text,
    );
  if (seven !== fourteen) next.windowDays = seven ? 7 : 14;
  if (
    (seven || fourteen) &&
    /首访后|获客后|成熟批次|首次访问后|新用户|新获客|after first|acquired users/i.test(
      text,
    ) &&
    !/自然月|calendar/i.test(text)
  ) {
    next.mode = "cohort";
    next.timeGrain = null;
  }
  const ranges = [
    ...text.matchAll(/(?:(20\d{2})年)?(1[0-2]|[1-9])月(上旬|中旬|下旬)/g),
  ];
  if (ranges.length && ranges.length <= 2)
    next.periods = ranges.map((match) => {
      const year = match[1] ?? "2019",
        month = Number(match[2]),
        part = match[3];
      const start =
        year +
        "-" +
        String(month).padStart(2, "0") +
        "-" +
        (part === "上旬" ? "01" : part === "中旬" ? "11" : "21");
      const end =
        part === "下旬"
          ? new Date(Date.UTC(Number(year), month, 1))
              .toISOString()
              .slice(0, 10)
          : year +
            "-" +
            String(month).padStart(2, "0") +
            "-" +
            (part === "上旬" ? "11" : "21");
      return { label: start + "→" + end, start, end };
    });
  if (
    /所有用户|全部用户|all users|不限付费渠道|(?:包含|包括|including)\s*organic/i.test(
      text,
    ) &&
    !/只(?:看|要|有)?\s*organic|only organic/i.test(text)
  ) {
    next.audience = /不(?:包含|包括)\s*organic|excluding organic/i.test(text)
      ? "paid"
      : "all";
    const mentioned = CHANNELS.filter(
      (channel) =>
        channel !== "organic" &&
        text.toLowerCase().includes(channel.toLowerCase()),
    );
    next.filters = {
      ...next.filters,
      channels: mentioned.length
        ? [
            ...mentioned,
            ...(/organic/i.test(text) && next.audience === "all"
              ? ["organic"]
              : []),
          ]
        : [],
    };
  }
  if (/趋势|走势|逐日|每日|daily|weekly|monthly|按天|按周|按月/i.test(text)) {
    next.mode = "calendar";
    next.timeGrain = /逐日|每日|daily|按天|每天/i.test(text)
      ? "day"
      : /逐周|每周|weekly|按周/i.test(text)
        ? "week"
        : "month";
    if (
      next.periods &&
      next.periods.length > 1 &&
      /至|到|through|from.+to/i.test(text) &&
      !/对比|比较|vs|versus/i.test(text)
    ) {
      const periods = next.periods;
      next.periods = [
        {
          label: periods.map((p) => p.label).join("–"),
          start: periods.map((p) => p.start).sort()[0],
          end: periods
            .map((p) => p.end)
            .sort()
            .at(-1)!,
        },
      ];
    }
  }
  if (
    /付费比例|购买用户比例|付费表现|付费情况|payer rate/i.test(text) &&
    next.metrics &&
    !next.metrics.includes("payer_rate")
  )
    next.metrics.push("payer_rate");
  if (/所有付费渠道|全部付费渠道|all paid channels/i.test(text)) {
    next.audience = "paid";
    next.filters = { ...next.filters, channels: [] };
  }
  if (next.periods) {
    const seen = new Set<string>();
    next.periods = next.periods.filter((period) => {
      const key = period.start + ":" + period.end;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (new Set(next.periods.map((p) => p.label)).size !== next.periods.length)
      next.periods = next.periods.map((period) => ({
        ...period,
        label: period.start + "→" + period.end,
      }));
  }
  const aliases: Record<string, string> = {
    "United Kingdom": "UK",
    Britain: "UK",
    英国: "UK",
    USA: "United States",
    US: "United States",
    美国: "United States",
    法国: "France",
    德国: "Germany",
  };
  if (next.filters?.regions)
    next.filters.regions = next.filters.regions.map((v) => aliases[v] ?? v);
  if (next.metrics) {
    const deps: Record<string, string[]> = {
      payer_rate: ["users", "payers"],
      revenue_per_user: ["revenue", "users"],
      revenue_per_payer: ["revenue", "payers"],
      repeat_payer_rate: ["payers"],
      cost_per_new_user: ["spend", "new_users"],
      revenue_to_spend: ["revenue", "spend"],
    };
    for (const metric of [...next.metrics])
      for (const dependency of deps[metric] ?? [])
        if (!next.metrics.includes(dependency as typeof metric))
          next.metrics.push(dependency as typeof metric);
  }
  return next;
}

export function isScopeOnly(text: string) {
  return (
    /^(只看|只保留|仅看|仅保留|清除|去掉|观察窗口|窗口|改成|改为|刚才|更正|纠正|only\b|clear\b|change (?:the )?(?:window|period|channel))/i.test(
      text.trim(),
    ) && !/多少|为什么|查询|统计|计算|how|why|what/i.test(text)
  );
}

export function protectScopePatch(
  text: string,
  patch: ContextPatch,
): ContextPatch {
  const allowed: ContextPatch = {};
  const unchanged = [...text.matchAll(/([^，。；]*)(?:保持|不变|unchanged)/gi)]
    .map((m) => m[1])
    .join(" ");
  const fixed = (words: RegExp) => words.test(unchanged);
  if (
    /年|月|时期|日期|date|period/i.test(text) &&
    !fixed(/时期|月份|日期|period|date/i) &&
    patch.periods
  )
    allowed.periods = patch.periods;
  if (
    /窗口|\d+\s*天|七天|十四天|首周|两周|一周|window|days|weeks/i.test(text) &&
    !fixed(/窗口|window/i) &&
    patch.windowDays
  )
    allowed.windowDays = patch.windowDays;
  if (
    /自然月|自然时期|calendar|批次|cohort|趋势|走势|按天|按周|按月|daily|weekly|monthly/i.test(
      text,
    )
  ) {
    if (patch.mode !== undefined) allowed.mode = patch.mode;
    if (patch.timeGrain !== undefined) allowed.timeGrain = patch.timeGrain;
  }
  if (
    /所有用户|全部用户|付费渠道|organic|自然流量|all users|paid channels/i.test(
      text,
    ) &&
    patch.audience
  )
    allowed.audience = patch.audience;
  if (
    /收入|费用|访问次数|用户数|购买次数|购买用户|复购|付费比例|转化率|revenue|spend|payer|sessions/i.test(
      text,
    ) &&
    !fixed(/指标|metrics/i) &&
    patch.metrics
  )
    allowed.metrics = patch.metrics;
  const f: NonNullable<ContextPatch["filters"]> = {};
  if (
    (/渠道|来源|channel|source/i.test(text) ||
      CHANNELS.some((v) => text.toLowerCase().includes(v.toLowerCase()))) &&
    !fixed(/渠道|channel|source/i) &&
    patch.filters?.channels !== undefined
  )
    f.channels = patch.filters.channels;
  if (
    /国家|地区|地域|region|country|France|Germany|UK|United States|英国|法国|德国|美国/i.test(
      text,
    ) &&
    !fixed(/国家|地区|region|country/i) &&
    patch.filters?.regions !== undefined
  )
    f.regions = patch.filters.regions;
  if (
    /设备|手机|电脑|device|iPhone|Android|\bMac\b|\bPC\b/i.test(text) &&
    !fixed(/设备|device/i) &&
    patch.filters?.devices !== undefined
  )
    f.devices = patch.filters.devices;
  if (Object.keys(f).length) allowed.filters = f;
  if (
    /按|拆|分组|分别|分开|group|split|by channel|by device|by country/i.test(
      text,
    ) &&
    patch.groupBy
  )
    allowed.groupBy = patch.groupBy;
  return allowed;
}

export function isWhyQuestion(text: string) {
  return /为什么|为何|怎么会|\bwhy\b/i.test(text);
}
