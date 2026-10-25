import { metricSchema, type Metric } from "@storewhy/contracts";
export const CHANNELS = [
  "organic",
  "TipTop",
  "RocketSuperAds",
  "YRabbit",
  "FaceBoom",
  "MediaTornado",
  "AdNonSense",
  "LeapBob",
  "WahooNetBanner",
  "OppleCreativeMedia",
  "lambdaMediaAds",
];
export const DEVICES = ["iPhone", "Mac", "Android", "PC"];
export const REGIONS = ["United States", "UK", "France", "Germany"];
export const COST_METRICS: Metric[] = [
  "spend",
  "cost_per_new_user",
  "revenue_to_spend",
];
export const LABELS: Record<Metric, string> = {
  spend: "记录渠道费用",
  sessions: "访问次数",
  users: "用户数",
  new_users: "首次观测用户数",
  payers: "购买用户数",
  purchases: "购买事件数",
  revenue: "收入",
  first_purchase_revenue: "首次购买收入",
  repeat_purchase_revenue: "后续购买收入",
  payer_rate: "购买用户比例",
  revenue_per_user: "每用户收入",
  revenue_per_payer: "每位购买用户收入",
  repeat_payer_rate: "复购用户比例",
  cost_per_new_user: "每位新用户记录费用",
  revenue_to_spend: "收入与记录费用比",
  avg_first_purchase_hours: "首次购买平均等待小时",
};
export const DEFINITIONS: Record<Metric, string> = {
  spend: "所选渠道与日期内记录的费用，金额单位未注明；不按设备或国家分摊",
  sessions: "所选时期/用户观察期内的访问记录数，按首次观测用户归属筛选",
  users:
    "自然时期内有访问或购买的用户数；批次模式为首次出现且具有完整观察期的用户数",
  new_users: "快照中首次访问发生在所选获客日期的用户数，不代表历史首次注册",
  payers: "时期或观察窗口内至少购买一次的不同用户数",
  purchases: "购买事件行数，不是不同购买用户数",
  revenue: "自然时期购买收入，或首访后 H 天收入；两种模式分别计算",
  first_purchase_revenue: "快照中每位用户首次购买产生的收入",
  repeat_purchase_revenue: "快照中每位用户首次购买之后的购买收入",
  payer_rate: "购买用户数 / 当前用户分母；批次模式分母为成熟首次出现用户",
  revenue_per_user: "收入 / 当前用户分母，属于观测收入，不是预测终身价值",
  revenue_per_payer: "收入 / 购买用户数",
  repeat_payer_rate: "窗口内至少购买两次用户数 / 至少购买一次用户数",
  cost_per_new_user:
    "匹配获客日期的渠道费用 / 首次观测用户数；不是实验获客成本",
  revenue_to_spend:
    "观测归属口径下的收入 / 匹配日期渠道费用；不是利润或因果增量",
  avg_first_purchase_hours:
    "已观测到首次购买的用户，从首次访问到首次购买的平均小时数；未购买用户不进入该平均值",
};
export function catalog(datasetVersion: string, backend: string) {
  return {
    dataset: {
      id: "procrastinate-pro-plus",
      version: datasetVersion,
      kind:
        backend === "fixture"
          ? "self_authored_fixture"
          : "public_teaching_sample",
      start: "2019-05-01",
      acquisitionEndExclusive: "2019-10-28",
      observationEndExclusive: "2019-11-01",
      currency: "unspecified",
      timezone: "source_naive",
    },
    channels: CHANNELS,
    devices: DEVICES,
    regions: REGIONS,
    metrics: metricSchema.options.map((id) => ({
      id,
      definition: DEFINITIONS[id],
      label: LABELS[id],
    })),
    dimensions: ["channel", "device", "region"],
    windows: [7, 14],
    timeGrains: ["day", "week", "month"],
    trendMode: "calendar",
    attribution: "first_observed_session",
    limitations: [
      "金额币种与时区未注明，沿用原始时间与样例金额单位",
      "没有广告曝光、点击、预算、素材或真实广告增量",
      "没有商品、结账步骤、退款或利润",
      "费用只有渠道和日期粒度；无法计算设备或国家广告费用",
      "订单没有 session ID；渠道、设备、国家使用首次观测访问归属",
      "organic 未提供费用，费用缺失不补零",
    ],
    dateEndIsExclusive: true,
  };
}
