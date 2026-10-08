'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  checkBudget,
  formatResetTime,
  formatUsd,
  raiseBudget,
  useUsageSummary,
  type BudgetCheck,
  type Feature,
  type UsageSummary,
} from '@/lib/usage-client';

const FEATURE_NAMES: Record<Feature, string> = {
  deep_research: 'Deep Research',
  news: 'News Hub',
  newsletter: 'Newsletter',
};

interface BudgetGate {
  /** Resolve true when the run may start: within budget, or the user raised today's limit. */
  ensureBudget: (feature: Feature) => Promise<boolean>;
  /** Open the raise dialog without a pending run (usage meter / banner / usage page). */
  openRaiseDialog: () => void;
  /** Shared live usage summary (one fetch for the meter, banner, cost hints and usage page). */
  summary: UsageSummary | null;
}

const BudgetGateContext = createContext<BudgetGate | null>(null);

export function useBudgetGate(): BudgetGate {
  const ctx = useContext(BudgetGateContext);
  if (!ctx) throw new Error('useBudgetGate must be used inside <BudgetGateProvider>');
  return ctx;
}

/** Whole-dollar steps above the current limit, up to the maximum. */
function raiseOptions(check: BudgetCheck): number[] {
  const options: number[] = [];
  for (let v = Math.floor(check.limitUsd) + 1; v <= check.maxLimitUsd; v++) options.push(v);
  return options;
}

/** Shared live usage summary from <BudgetGateProvider>. */
export function useUsage(): UsageSummary | null {
  return useBudgetGate().summary;
}

export function BudgetGateProvider({ children }: { children: React.ReactNode }) {
  const { summary } = useUsageSummary();
  const [state, setState] = useState<{ check: BudgetCheck; feature: Feature | null } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [consented, setConsented] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const open = useCallback((check: BudgetCheck, feature: Feature | null) => {
    const options = raiseOptions(check);
    const needed = check.spentUsd + (feature ? check.estimateUsd : 0);
    setSelected(options.find((v) => v >= needed) ?? options[options.length - 1] ?? null);
    setConsented(false);
    setError(null);
    setState({ check, feature });
  }, []);

  const close = useCallback((ok: boolean) => {
    setState(null);
    resolveRef.current?.(ok);
    resolveRef.current = null;
  }, []);

  const ensureBudget = useCallback(
    async (feature: Feature) => {
      const check = await checkBudget(feature).catch(() => null);
      if (!check || check.allowed) return true; // server still enforces if the pre-check failed
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        open(check, feature);
      });
    },
    [open],
  );

  const openRaiseDialog = useCallback(async () => {
    const check = await checkBudget('news').catch(() => null);
    if (check) open(check, null);
  }, [open]);

  async function handleRaise() {
    if (selected == null || !consented) return;
    setSaving(true);
    const result = await raiseBudget(selected);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    close(true);
  }

  const check = state?.check;
  const feature = state?.feature ?? null;
  const options = check ? raiseOptions(check) : [];
  const atMax = check ? check.limitUsd >= check.maxLimitUsd : false;
  const reset = check ? formatResetTime(check.resetsAt) : '';

  return (
    <BudgetGateContext.Provider value={{ ensureBudget, openRaiseDialog, summary }}>
      {children}
      <Dialog open={state !== null} onOpenChange={(o) => !o && close(false)}>
        {check && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[#d03b3b]" aria-hidden />
                {feature
                  ? check.spentUsd >= check.limitUsd
                    ? 'Daily budget reached'
                    : 'This run would go over today’s budget'
                  : 'Raise today’s budget'}
              </DialogTitle>
              <DialogDescription>
                You’ve used <strong>{formatUsd(check.spentUsd)}</strong> of today’s{' '}
                <strong>{formatUsd(check.limitUsd)}</strong>.
                {feature && (
                  <>
                    {' '}A {FEATURE_NAMES[feature]} run costs about <strong>{formatUsd(check.estimateUsd)}</strong>{' '}
                    (average of your recent runs).
                  </>
                )}
              </DialogDescription>
            </DialogHeader>

            {atMax ? (
              <p className="text-sm text-muted-foreground">
                Today’s limit is already at the maximum of {formatUsd(check.maxLimitUsd)}. Usage resets at {reset}.
              </p>
            ) : (
              <div className="space-y-4">
                <fieldset>
                  <legend className="text-sm font-medium mb-2">Raise today’s limit to</legend>
                  <div className="flex gap-2" role="radiogroup">
                    {options.map((v) => (
                      <Button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={selected === v}
                        variant={selected === v ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setSelected(v)}
                      >
                        ${v}
                      </Button>
                    ))}
                  </div>
                </fieldset>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={consented}
                    onChange={(e) => setConsented(e.target.checked)}
                  />
                  <span>
                    I approve raising today’s limit to {selected != null ? `$${selected}` : '—'}. It returns to{' '}
                    {formatUsd(check.defaultLimitUsd)} at {reset}. This approval is recorded.
                  </span>
                </label>
                {error && <p className="text-sm text-[#d03b3b]">{error}</p>}
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)}>
                {atMax ? 'Close' : 'Not now'}
              </Button>
              {!atMax && (
                <Button onClick={handleRaise} disabled={!consented || selected == null || saving}>
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {feature ? 'Raise & run' : 'Raise limit'}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </BudgetGateContext.Provider>
  );
}
