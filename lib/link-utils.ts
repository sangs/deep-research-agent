/**
 * Shared helper for displaying a list of article links in the UI.
 *
 * The Links panel shows only each URL's hostname (the full path is often a
 * huge opaque tracking token, unreadable as display text). But several
 * genuinely different article links can share the same tracking-redirector
 * hostname within one digest entry (e.g. multiple distinct
 * utm.genai.works/r/xxxxx citations in one newsletter summary) — shown as
 * hostname-only text, they'd be visually indistinguishable from real
 * duplicates. Appending a numbered suffix when a hostname repeats within the
 * same list makes clear they're different links without showing the full,
 * often-illegible path.
 */

export interface LabeledLink {
  url: string;
  label: string;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function labelLinks(links: string[]): LabeledLink[] {
  const hostnames = links.map(hostnameOf);

  const counts = new Map<string, number>();
  for (const h of hostnames) counts.set(h, (counts.get(h) ?? 0) + 1);

  const seen = new Map<string, number>();
  return links.map((url, i) => {
    const hostname = hostnames[i];
    if ((counts.get(hostname) ?? 1) <= 1) return { url, label: hostname };
    const occurrence = (seen.get(hostname) ?? 0) + 1;
    seen.set(hostname, occurrence);
    return { url, label: `${hostname} (${occurrence})` };
  });
}
