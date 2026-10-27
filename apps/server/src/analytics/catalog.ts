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
  spend: "Recorded acquisition spend",
  sessions: "Sessions",
  users: "Users",
  new_users: "New users",
  payers: "Purchasers",
  purchases: "Purchase events",
  revenue: "Revenue",
  first_purchase_revenue: "First-purchase revenue",
  repeat_purchase_revenue: "Repeat-purchase revenue",
  payer_rate: "Purchaser rate",
  revenue_per_user: "Revenue per user",
  revenue_per_payer: "Revenue per purchaser",
  repeat_payer_rate: "Repeat purchaser rate",
  cost_per_new_user: "Recorded spend per new user",
  revenue_to_spend: "Revenue / recorded spend",
  avg_first_purchase_hours: "Average hours to first purchase",
};
export const DEFINITIONS: Record<Metric, string> = {
  spend:
    "Recorded spend for the selected channels and dates, in an unspecified currency; it is not allocated by device or country",
  sessions:
    "Visit records in the selected period or observation window, filtered by first-observed attribution",
  users:
    "Users with a visit or purchase in a calendar period; in cohort mode, first-observed users with a complete observation window",
  new_users:
    "Users whose first visit in the snapshot falls within the selected acquisition dates; this is not historical registration",
  payers: "Distinct users with at least one purchase in the period or window",
  purchases: "Purchase-event rows, not distinct purchasers",
  revenue:
    "Purchase revenue in a calendar period, or within H days after first visit; the two modes are calculated separately",
  first_purchase_revenue:
    "Revenue from each user's first purchase in the snapshot",
  repeat_purchase_revenue:
    "Revenue from purchases after each user's first purchase in the snapshot",
  payer_rate:
    "Purchasers / current user denominator; in cohort mode the denominator is mature first-observed users",
  revenue_per_user:
    "Revenue / current user denominator; observed revenue, not predicted lifetime value",
  revenue_per_payer: "Revenue / purchasers",
  repeat_payer_rate:
    "Users with at least two purchases in the window / users with at least one purchase",
  cost_per_new_user:
    "Channel spend on matching acquisition dates / first-observed users; not experimental acquisition cost",
  revenue_to_spend:
    "Observed attributed revenue / channel spend on matching dates; not profit or causal lift",
  avg_first_purchase_hours:
    "Average hours from first visit to first purchase among observed purchasers; non-purchasers are excluded",
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
      "Currency and time zone are unspecified; source timestamps and sample amount units are preserved",
      "No ad impressions, clicks, budgets, creative data, or true advertising lift are available",
      "No product, checkout-step, refund, or profit data are available",
      "Spend is available only by channel and date, so device- or country-level ad spend cannot be calculated",
      "Orders have no session ID; channel, device, and country use first-observed-session attribution",
      "Organic spend is unavailable; missing spend is not replaced with zero",
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
      labels.push(filters[key].join(", "));
  return labels.join(" / ") || "Overall";
}
