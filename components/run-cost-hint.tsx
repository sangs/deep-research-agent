'use client';

import { useUsage } from '@/components/budget-gate';
import { formatUsd, type Feature } from '@/lib/usage-client';

/** "~$0.05 per run · $1.40 left today" under a Run button (estimate = average of recent runs). */
export function RunCostHint({ feature, className = '' }: { feature: Feature; className?: string }) {
  const summary = useUsage();
  if (!summary) return null;
  const estimate = summary.byFeature.find((f) => f.feature === feature)?.estimateUsd ?? 0;
  const left = Math.max(0, summary.limitUsd - summary.spentUsd);
  return (
    <p className={`text-[11px] text-muted-foreground tabular-nums ${className}`}>
      ~{formatUsd(estimate)} per run · {formatUsd(left)} left today
    </p>
  );
}
