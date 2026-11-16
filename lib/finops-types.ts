// /finops response contract (design 16 §4.2), produced by backend/services/finops_summary.py.
// To move to the shared @finops-admin/contract package when cortex-drive builds its page.

export interface FinopsSummary {
  project: string;
  currency: 'USD';
  generated_at: string;
  cached: boolean;
  as_of: Record<string, string | null>;
  totals: {
    today: number;
    month_to_date: number;
    last_month: number;
    forecast_month_end: number;
    threshold: number | null; // null = record only
    pct_of_threshold: number | null;
  };
  live: { app_spend_today_utc: number | null };
  by_provider: { provider: string; mtd: number; sources: string[] }[];
  by_gcp_service: { service: string; mtd: number }[];
  daily: { date: string; provider: string; cost: number }[];
  sources: { source: string; provider: string; as_of: string | null; stale: boolean }[];
  alerts: { level: 'warning' | 'critical'; message: string }[];
  untracked_before: string | null;
}

/** Where each number comes from, in words. */
export const SOURCE_LABEL: Record<string, string> = {
  billing_export: 'Google Cloud billing export',
  app_recorded: 'recorded by this app',
  plan: 'fixed monthly plan',
  provider_api: 'provider API',
};
