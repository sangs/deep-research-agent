import { NextResponse } from 'next/server';
import { sessionUser } from '@/lib/user-id';
import { isOwnerEmail } from '@/lib/auth-allowlist';

// GET /api/usage/providers — owner-only account view. Uses only the inference
// key the app already holds: OpenRouter's /key endpoint reports on that key
// itself and can't change anything. No provider admin/billing credentials are
// stored in the app; everything else is a link to the provider's dashboard.
export async function GET() {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isOwnerEmail(user.email)) return NextResponse.json({ error: 'Owner only' }, { status: 403 });

  let openrouter: Record<string, unknown> | { error: string };
  try {
    const headers = { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` };
    const [keyRes, creditsRes] = await Promise.all([
      fetch('https://openrouter.ai/api/v1/key', { headers, cache: 'no-store' }),
      fetch('https://openrouter.ai/api/v1/credits', { headers, cache: 'no-store' }),
    ]);
    const { data } = await keyRes.json();
    const credits = creditsRes.ok ? (await creditsRes.json()).data : null;
    openrouter = {
      // Account prepaid balance: when it reaches $0 every AI call fails (HTTP 402).
      creditsPurchasedUsd: credits?.total_credits ?? null,
      creditsUsedUsd: credits?.total_usage ?? null,
      creditsRemainingUsd: credits ? credits.total_credits - credits.total_usage : null,
      label: data.label,
      usageUsd: data.usage,
      usageTodayUsd: data.usage_daily,
      limitUsd: data.limit,
      limitRemainingUsd: data.limit_remaining,
      limitReset: data.limit_reset,
    };
  } catch {
    openrouter = { error: 'Could not reach OpenRouter' };
  }

  return NextResponse.json({
    fetchedAt: Date.now(),
    openrouter,
    links: [
      { name: 'OpenRouter activity (per-call model, tokens, cost)', url: 'https://openrouter.ai/activity' },
      { name: 'OpenRouter keys & credit limit', url: 'https://openrouter.ai/settings/keys' },
      { name: 'Exa usage & billing', url: 'https://dashboard.exa.ai' },
      { name: 'Google Cloud billing (Cloud Run, Secret Manager)', url: 'https://console.cloud.google.com/billing' },
      { name: 'Supabase usage', url: 'https://supabase.com/dashboard' },
    ],
  });
}
