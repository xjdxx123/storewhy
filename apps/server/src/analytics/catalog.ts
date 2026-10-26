import {
  metricSchema,
  type Metric,
  type Dimension,
  type AnalysisSpec,
} from "@storewhy/contracts";
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
  spend: "Recorded channel spend",
  sessions: "Sessions",
  users: "Users",
  new_users: "Newly observed users",
  payers: "Purchasing users",
  purchases: "Purchase events",
  revenue: "Revenue",
  first_purchase_revenue: "First purchase revenue",
  repeat_purchase_revenue: "Subsequent purchase revenue",
  payer_rate: "Purchaser rate",
  revenue_per_user: "Revenue per user",
  revenue_per_payer: "Revenue per purchasing user",
  repeat_payer_rate: "Repeat purchaser rate",
  cost_per_new_user: "Recorded cost per new user",
  revenue_to_spend: "Revenue to recorded spend",
  avg_first_purchase_hours: "Average hours to first purchase",
};
export const DEFINITIONS: Record<Metric, string> = {
  spend:
    "Spend recorded for selected channels and dates; currency is unspecified. No allocation to devices or countries.",
  sessions:
    "Visit records within the period or user observation window, filtered by first observed attribution.",
  users:
    "Users visiting or purchasing in the calendar period; in cohort mode, newly observed users with a complete follow-up window.",
  new_users:
    "Users whose first observed visit in this snapshot falls within the acquisition dates; not lifetime first registrations.",
  payers:
    "Distinct users with at least one purchase in the period or observation window.",
  purchases: "Purchase event rows, rather than distinct purchasing users.",
  revenue:
    "Purchase revenue in the calendar period, or within H days after first visit; calculated separately for each mode.",
  first_purchase_revenue:
    "Revenue from each user's first observed purchase in the snapshot.",
  repeat_purchase_revenue:
    "Revenue from purchases after each user's first observed purchase in the snapshot.",
  payer_rate:
    "Purchasing users / users in scope; cohort mode uses newly observed users with complete follow-up.",
  revenue_per_user:
    "Revenue / users in scope; observed revenue, not predicted lifetime value.",
  revenue_per_payer: "Revenue / distinct purchasing users.",
  repeat_payer_rate:
    "Users with at least two purchases / users with at least one purchase in the window.",
  cost_per_new_user:
    "Channel spend for matching acquisition dates / newly observed users; not experimental acquisition cost.",
  revenue_to_spend:
    "Observed attributed revenue / channel spend for matching dates; not profit or causal incrementality.",
  avg_first_purchase_hours:
    "Mean hours from first visit to first purchase among observed purchasers; non-purchasers are excluded.",
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
      "Currency and timezone are unspecified; source timestamps and sample amount units are retained.",
      "No ad impressions, clicks, budgets, creatives or measured ad incrementality.",
      "No products, checkout steps, refunds or profit data.",
      "Spend is available only by channel and date; device or country ad spend cannot be calculated.",
      "Orders have no session ID; channel, device and country use first observed visit attribution.",
      "Organic spend is unavailable; missing spend is never filled with zero.",
    ],
    dateEndIsExclusive: true,
  };
}

export function segmentLabel(
  dimensions: Partial<Record<Dimension, string>>,
  filters: AnalysisSpec["filters"],
) {
  const labels = Object.values(dimensions);
  for (const [dimension, key] of [
    ["channel", "channels"],
    ["device", "devices"],
    ["region", "regions"],
  ] as const)
    if (!dimensions[dimension] && filters[key].length)
      labels.push(filters[key].join("、"));
  return labels.join(" / ") || "Overall";
}
