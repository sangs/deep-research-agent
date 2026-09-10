"""gmail_service.py — Gmail newsletter digest for the News Hub Newsletter panel.

Extracted and adapted from gmail_tool.py (standalone CLI project).

Key differences from the original CLI tool:
  - No argparse / draft creation / HTML email builder / terminal output
  - NLP clustering (sentence-transformers, spaCy, scikit-learn) replaced by
    LLM topic clustering via OpenRouter — no heavy NLP dependencies needed
  - Summarization via OpenRouter instead of the Anthropic SDK directly
  - Fully async-compatible (sync Gmail API calls wrapped in asyncio.to_thread)
  - Returns NewsDigest Pydantic model — same schema as all other News Hub tabs

Auth setup (one-time local step):
  1. Download credentials.json from Google Cloud Console → APIs & Services → Credentials
     (OAuth 2.0 Client ID, type: Desktop app)
  2. Set GMAIL_CREDENTIALS_PATH in .env.local (default: ~/credentials.json)
  3. Set GMAIL_TOKEN_PATH in .env.local (default: ~/gmail_token.json)
  4. Run once to authorize:
       cd backend && uv run python -c "from services.gmail_service import get_gmail_service; get_gmail_service()"
     A browser window opens — sign in and grant access.
  5. The token is saved to GMAIL_TOKEN_PATH and auto-refreshed on every subsequent call.

Token renewal (if you see "invalid_grant: Bad Request"):
  The stored refresh token has been revoked or expired. This happens when your Google
  account password changes, you revoke access in Google Account settings, or the token
  has not been used for more than 6 months.
  Fix: delete the old token and re-run the auth flow:
       rm ~/gmail_token.json   # or the path set in GMAIL_TOKEN_PATH
       cd backend && uv run python -c "from services.gmail_service import get_gmail_service; get_gmail_service()"

Label behaviour (unchanged from original):
  - Every matched email is tagged [gmail-ai-digested] (informational only, reruns are safe)
  - The tag does NOT exclude emails from future runs
"""

import asyncio
import base64
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Awaitable
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

import httpx
from dotenv import load_dotenv

from models.schemas import NewsDigest, TopicCluster, ArticleItem
from tools.date_utils import resolve_date_range, format_header_date, now_iso
from tools.news_tools import load_sources

load_dotenv()

OPENROUTER_API_KEY = os.getenv('OPENROUTER_API_KEY', '')
MODEL = '~google/gemini-flash-latest'

# Gmail label constants
DIGESTED_LABEL = 'gmail-ai-digested'   # applied to every matched email
DIGEST_FOLDER  = 'Digest'              # used by standalone tool; kept for reference

# Scale guardrails — a "past month" pull across many senders can return
# hundreds of emails; these bound the work done per digest run.
MAX_EMAILS_FETCH   = 500  # hard cap on emails fetched per digest run
CLUSTER_BATCH_SIZE = 50   # topic-clustering LLM calls are split into batches of
                           # this size (see _cluster_via_llm_batched) instead of
                           # falling back to by-source grouping above a threshold —
                           # keeps every LLM prompt small regardless of total email
                           # count while still honoring an explicit "By topic" choice

# Gmail OAuth scopes — modify permission allows labelling matched emails
SCOPES = ['https://www.googleapis.com/auth/gmail.modify']

# URL patterns to skip when picking a citation link (tracking/management links)
_URL_SKIP = (
    'unsubscribe', 'optout', 'opt-out', 'manage', 'preferences',
    'pixel', 'beacon', 'track', 'click.', 'open.', 'list-manage',
    'mailchimp', 'sendgrid', 'constantcontact', 'campaign-archive',
    '.gif', '.png', '.jpg', '.ico', 'mailto:', 'feedback=', '/fb/',
)

# Zero-width / invisible Unicode chars injected by ESP platforms (e.g. Beehiiv)
_ZW_CHARS = re.compile(
    r'[\u034f\u200b\u200c\u200d\u200e\u200f\u00ad\ufeff'
    r'\u2028\u2029\u00a0]'
)
_HTML_ENTITIES = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&nbsp;': ' ', '&apos;': "'",
}
_HTML_ENTITY_RE = re.compile('|'.join(re.escape(k) for k in _HTML_ENTITIES))


# ═══════════════════════════════════════════════════════════════════════════
# PATHS
# ═══════════════════════════════════════════════════════════════════════════

def _credentials_path() -> Path:
    return Path(os.getenv('GMAIL_CREDENTIALS_PATH', str(Path.home() / 'credentials.json')))


def _token_path() -> Path:
    return Path(os.getenv('GMAIL_TOKEN_PATH', str(Path.home() / 'gmail_token.json')))


# ═══════════════════════════════════════════════════════════════════════════
# AUTH
# ═══════════════════════════════════════════════════════════════════════════

def get_gmail_service():
    """Return an authenticated Gmail API service object.

    Auth resolution order (first match wins):
      1. GMAIL_TOKEN_JSON env var — JSON string of the token (Railway / production)
      2. GMAIL_TOKEN_PATH file    — local filesystem token (local dev, default ~/gmail_token.json)

    If neither exists, falls back to InstalledAppFlow (opens browser — local dev only).

    Token refresh is handled automatically by google-auth. On Railway the refreshed
    token lives in memory only; the GMAIL_TOKEN_JSON env var does not need updating
    because the refresh_token itself does not expire unless revoked.
    """
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    token_json_env = os.getenv('GMAIL_TOKEN_JSON', '').strip()
    creds_json_env = os.getenv('GMAIL_CREDENTIALS_JSON', '').strip()
    token_path = _token_path()
    creds_path = _credentials_path()

    # ── Load token ────────────────────────────────────────────────────────────
    creds = None
    if token_json_env:
        # Production: token stored as env var JSON string
        creds = Credentials.from_authorized_user_info(json.loads(token_json_env), SCOPES)
    elif token_path.exists():
        # Local dev: token stored as file
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

    # ── Refresh or run initial OAuth flow ─────────────────────────────────────
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            # Auto-refresh using stored refresh_token (works on Railway)
            creds.refresh(Request())
            # Persist refreshed token locally if running with file-based auth
            if not token_json_env and token_path.exists():
                token_path.write_text(creds.to_json())
        else:
            # Initial OAuth flow — local dev only (requires browser)
            if creds_json_env:
                import tempfile
                with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
                    f.write(creds_json_env)
                    tmp_creds_path = f.name
                flow = InstalledAppFlow.from_client_secrets_file(tmp_creds_path, SCOPES)
                Path(tmp_creds_path).unlink(missing_ok=True)
            elif creds_path.exists():
                flow = InstalledAppFlow.from_client_secrets_file(str(creds_path), SCOPES)
            else:
                raise FileNotFoundError(
                    'Gmail token not found. '
                    'On Railway: set the GMAIL_TOKEN_JSON environment variable '
                    '(copy ~/gmail_token.json contents from your local machine). '
                    f'On local dev: place gmail_token.json at {token_path} and run the one-time OAuth flow.'
                )
            creds = flow.run_local_server(port=0)
            token_path.write_text(creds.to_json())

    return build('gmail', 'v1', credentials=creds)


# ═══════════════════════════════════════════════════════════════════════════
# TEXT / URL HELPERS
# ═══════════════════════════════════════════════════════════════════════════

def _clean_snippet(text: str) -> str:
    """Strip invisible Unicode padding chars and decode common HTML entities."""
    text = _ZW_CHARS.sub('', text)
    text = re.sub(
        r'&(?:#8204|#8203|#x200[bcdefBCDEF]|zwnj|zwsp|zwj|#x034f|#847);',
        '', text, flags=re.IGNORECASE,
    )
    text = _HTML_ENTITY_RE.sub(lambda m: _HTML_ENTITIES[m.group()], text)
    text = re.sub(r'[ \t]{2,}', ' ', text)
    return text.strip()


def decode_body(payload) -> str:
    """Recursively extract plain-text (preferred) or stripped HTML body."""
    mime      = payload.get('mimeType', '')
    body_data = payload.get('body', {}).get('data', '')

    if mime == 'text/plain' and body_data:
        return base64.urlsafe_b64decode(body_data).decode('utf-8', errors='replace')

    if mime == 'text/html' and body_data:
        raw  = base64.urlsafe_b64decode(body_data).decode('utf-8', errors='replace')
        text = re.sub(r'<style[^>]*>.*?</style>', ' ', raw,  flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<script[^>]*>.*?</script>', ' ', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = re.sub(r'\s{3,}', '\n\n', text)
        return text.strip()

    if 'parts' in payload:
        plain_parts, html_parts = [], []
        for part in payload['parts']:
            result = decode_body(part)
            if result:
                (plain_parts if part.get('mimeType') == 'text/plain' else html_parts).append(result)
        plain_text = '\n\n'.join(plain_parts)
        html_text  = '\n\n'.join(html_parts)
        # Newsletters pad their text/plain with zero-width chars to hit quota —
        # strip them BEFORE the length check so we don't discard the full HTML body.
        plain_meaningful = _ZW_CHARS.sub('', plain_text).strip()
        if plain_meaningful and len(plain_meaningful) >= 200:
            return plain_text
        return html_text or plain_text

    return ''


# Trailing characters a plain-text URL regex can't distinguish from real URL
# content when the source is markdown — e.g. the ')' closing a markdown link
# '[text](url)', the '**' closing a bold span around one, or a bold-wrapped
# colon immediately after a link ('...(url)**:**'). Never legitimate at the
# very end of a real destination URL.
_TRAILING_MD_PUNCT = ')*:'


def _trim_trailing_markdown_junk(url: str) -> str:
    """Iteratively strip trailing markdown-syntax punctuation a plain-text URL
    regex can't tell apart from real URL characters. Many newsletters (this
    one included) write their body in markdown, so this is a common,
    sender-agnostic source of malformed extracted URLs, not a one-off —
    e.g. '**[Join the Hackathon](https://x.com/r/vd8agqk)**' extracts as
    'https://x.com/r/vd8agqk)**' without this.

    A trailing ')' is only stripped while UNBALANCED (more ')' than '(' in
    the string) — a URL that legitimately contains a matched parenthesis in
    its own path (e.g. a Wikipedia disambiguation link) is left untouched.
    '*' and ':' are always stripped from the end — neither is ever a
    legitimate final character of a real destination URL.
    """
    while url and url[-1] in _TRAILING_MD_PUNCT:
        if url[-1] == ')' and url.count(')') <= url.count('('):
            break  # balanced trailing paren — genuinely part of the URL
        url = url[:-1]
    return url


def extract_urls(text: str) -> list[str]:
    """Extract http(s) URLs from plain text, filtering out tracking/utility links.

    Decodes HTML entities (e.g. a visible-URL anchor text containing literal
    &amp;) so this matches extract_hrefs()'s already-decoded output — without
    this, the same destination URL can enter `links` twice in two differently
    encoded forms (one from each extractor), both surviving dedup_key() as
    distinct entries, and a mangled `&amp;amp;`-containing variant could win
    pick_primary_link()'s scoring and become a broken clickable article link.
    """
    raw = re.findall(r'https?://[^\s<>"{}|\\^`\[\]]*[^\s<>"{}|\\^`\[\].,;:!?]', text)
    decoded = [_HTML_ENTITY_RE.sub(lambda m: _HTML_ENTITIES[m.group()], u) for u in raw]
    trimmed = [_trim_trailing_markdown_junk(u) for u in decoded]
    return [u for u in trimmed if not any(s in u.lower() for s in _URL_SKIP)]


_HREF_RE = re.compile(r'href\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)


def extract_hrefs(payload) -> list[str]:
    """Recursively extract href="..." URLs from raw HTML MIME parts.

    decode_body() strips all HTML tags (including anchor hrefs) before
    extract_urls() ever sees the text, so styled newsletters whose CTA links
    live only in an href attribute (visible text like "Read more" or an emoji
    label, not the URL itself — e.g. AlphaSignal) lose their links entirely.
    This walks the payload tree independently, before tag-stripping, so those
    hrefs survive.
    """
    mime      = payload.get('mimeType', '')
    body_data = payload.get('body', {}).get('data', '')
    hrefs: list[str] = []

    if mime == 'text/html' and body_data:
        raw = base64.urlsafe_b64decode(body_data).decode('utf-8', errors='replace')
        for href in _HREF_RE.findall(raw):
            href = _HTML_ENTITY_RE.sub(lambda m: _HTML_ENTITIES[m.group()], href)
            href = _trim_trailing_markdown_junk(href)
            if not href.lower().startswith(('http://', 'https://')):
                continue  # skip mailto:, tel:, #anchor, javascript: etc.
            if any(s in href.lower() for s in _URL_SKIP):
                continue
            hrefs.append(href)

    if 'parts' in payload:
        for part in payload['parts']:
            hrefs.extend(extract_hrefs(part))

    return hrefs


# Cosmetic query params that don't distinguish one link's destination from
# another (safe to ignore for dedup). Anything else — e.g. AlphaSignal's
# `lid=` — is kept, since some senders wrap every distinct article behind an
# identical-path click-tracking redirector (`app.alphasignal.ai/c?...lid=X`)
# and put the only distinguishing signal in the query string.
_COSMETIC_QUERY_PARAMS = {
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'ref', 'referrer', 'fbclid', 'gclid', 'mc_cid', 'mc_eid',
}


def dedup_key(url: str) -> str:
    """Normalize a URL for deduplication — strips cosmetic tracking params
    but preserves other query params that may carry real link identity.

    Decodes HTML entities defensively before parsing, so two encodings of the
    same URL (one raw, one already-decoded) still normalize to the same key
    even if some future extraction path forgets to decode at the source —
    extract_urls() decodes at the source already; this is defense-in-depth.
    """
    url = _HTML_ENTITY_RE.sub(lambda m: _HTML_ENTITIES[m.group()], url)
    parsed = urlparse(url)
    kept = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
            if k.lower() not in _COSMETIC_QUERY_PARAMS]
    query = urlencode(kept)
    return urlunparse(parsed._replace(query=query, fragment='')).rstrip('/')


def pick_primary_link(urls: list[str]) -> str:
    """Return the most article-like URL — prefers longer path+query, deduplicates.

    Path+query (not path alone) is the scoring signal because click-tracking
    redirectors often share one short path across every article ('/c') and
    encode the real distinguishing identity in the query string.
    """
    seen, unique = set(), []
    for u in urls:
        norm = dedup_key(u)
        if norm not in seen:
            seen.add(norm)
            unique.append(u)
    if not unique:
        return ''
    def specificity(u: str) -> int:
        p = urlparse(u)
        return len(p.path.strip('/')) + len(p.query)
    meaningful = [u for u in unique if specificity(u) > 3]
    candidates = meaningful or unique
    return max(candidates, key=specificity)


def sender_display(from_header: str) -> str:
    """Extract the display name from a From header ('Name <email@domain.com>')."""
    m = re.match(r'^"?([^"<]+)"?\s*<', from_header)
    if m:
        return m.group(1).strip()
    m2 = re.match(r'^([^@]+)@', from_header)
    if m2:
        return m2.group(1).strip()
    return from_header.strip()


# ═══════════════════════════════════════════════════════════════════════════
# LABEL MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════

def _list_all_labels(service) -> dict[str, str]:
    result = service.users().labels().list(userId='me').execute()
    return {lbl['name'].lower(): lbl['id'] for lbl in result.get('labels', [])}


def ensure_label(service, name: str) -> str:
    """Return the label ID for `name`, creating it if it doesn't exist."""
    labels = _list_all_labels(service)
    if name.lower() in labels:
        return labels[name.lower()]
    body = {
        'name': name,
        'labelListVisibility': 'labelShow',
        'messageListVisibility': 'show',
    }
    new_label = service.users().labels().create(userId='me', body=body).execute()
    return new_label['id']


def apply_label_to_messages(service, message_ids: list[str], label_id: str) -> None:
    """Batch-apply label_id to message_ids. Idempotent — reruns are safe."""
    if not message_ids:
        return
    for i in range(0, len(message_ids), 1000):
        batch = message_ids[i:i + 1000]
        service.users().messages().batchModify(
            userId='me',
            body={'ids': batch, 'addLabelIds': [label_id]},
        ).execute()


# ═══════════════════════════════════════════════════════════════════════════
# EMAIL FETCHING
# ═══════════════════════════════════════════════════════════════════════════

def build_query(start_iso: str, end_iso: str, senders: list[str], subject_kw: str) -> str:
    """Build a Gmail search query string from ISO datetime strings and filters.

    Uses epoch timestamps for after:/before: to avoid locale date-format issues.
    Does NOT exclude [gmail-ai-digested] emails — reruns always see the same set.
    """
    try:
        start_epoch = int(datetime.fromisoformat(start_iso).timestamp())
        end_epoch   = int(datetime.fromisoformat(end_iso).timestamp())
    except Exception:
        # Fallback: treat as YYYY-MM-DD
        start_epoch = int(datetime.strptime(start_iso[:10], '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp())
        end_epoch   = int(datetime.strptime(end_iso[:10], '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp()) + 86400

    parts = [f'after:{start_epoch}', f'before:{end_epoch}']

    if senders:
        from_clause = ' OR '.join(f'from:{s.strip()}' for s in senders)
        parts.append(f'({from_clause})')

    if subject_kw:
        parts.append(f'subject:({subject_kw})')

    return ' '.join(parts)


def fetch_emails(service, query: str, max_results: int = MAX_EMAILS_FETCH) -> tuple[list[dict], int]:
    """Fetch full email objects matching query (sync — call via asyncio.to_thread).

    Returns (emails, total_estimate) — total_estimate is Gmail's own count of
    all matching messages (from resultSizeEstimate on the first page), which
    may exceed max_results. Callers use this to tell the user when results
    were truncated instead of silently dropping the rest.
    """
    messages, page_token, total_estimate = [], None, None
    while True:
        kwargs = {'userId': 'me', 'q': query, 'maxResults': min(max_results, 100)}
        if page_token:
            kwargs['pageToken'] = page_token
        resp = service.users().messages().list(**kwargs).execute()
        if total_estimate is None:
            total_estimate = resp.get('resultSizeEstimate', 0)
        batch = resp.get('messages', [])
        messages.extend(batch)
        page_token = resp.get('nextPageToken')
        if not page_token or len(messages) >= max_results:
            break

    emails = []
    for msg in messages[:max_results]:
        full = service.users().messages().get(
            userId='me', id=msg['id'], format='full'
        ).execute()
        headers = {h['name'].lower(): h['value'] for h in full['payload'].get('headers', [])}
        body    = decode_body(full['payload'])
        links   = extract_urls(body) + extract_urls(full.get('snippet', '')) + extract_hrefs(full['payload'])
        emails.append({
            'id':      msg['id'],
            'subject': headers.get('subject', '(no subject)'),
            'from':    headers.get('from', ''),
            'date':    headers.get('date', ''),
            'body':    _clean_snippet(body),
            'snippet': _clean_snippet(full.get('snippet', '')),
            'links':   links,
        })

    return emails, max(total_estimate or 0, len(emails))


# ═══════════════════════════════════════════════════════════════════════════
# SOURCE GROUPING (by-source mode — no LLM needed)
# ═══════════════════════════════════════════════════════════════════════════

def _group_by_source(emails: list[dict]) -> tuple[list[list[int]], list[str]]:
    """Group email indices by sender display name, sorted by count desc."""
    groups: dict[str, list[int]] = {}
    for i, e in enumerate(emails):
        name = sender_display(e['from'])
        groups.setdefault(name, []).append(i)
    sorted_groups = sorted(groups.items(), key=lambda x: len(x[1]), reverse=True)
    return [idxs for _, idxs in sorted_groups], [name for name, _ in sorted_groups]


# ═══════════════════════════════════════════════════════════════════════════
# LLM CLUSTERING (replaces sentence-transformers + spaCy + scikit-learn)
# ═══════════════════════════════════════════════════════════════════════════

async def _cluster_via_llm(
    emails: list[dict],
) -> tuple[list[list[int]], list[str]]:
    """Cluster emails into topic groups using the LLM via OpenRouter.

    Returns (clusters, cluster_names) where clusters[i] is a list of email
    indices belonging to topic i, sorted by cluster size descending.
    Falls back to by-source grouping if the LLM call fails.
    """
    if not emails:
        return [], []

    # Build a compact list of emails for the prompt
    lines = []
    for i, e in enumerate(emails):
        snippet = (e['snippet'] or e['body'][:100]).replace('\n', ' ')[:120]
        lines.append(f'[{i}] From: {sender_display(e["from"])} | Subject: {e["subject"]} | Preview: {snippet}')

    email_block = '\n'.join(lines)

    prompt = f"""You are grouping newsletter emails into topic clusters for a news digest.

Emails ({len(emails)} total):
{email_block}

Group these emails into 2-8 topic clusters based on subject and content.
Each email must appear in exactly one cluster.
Return ONLY valid JSON — no markdown, no explanation:
{{
  "topics": [
    {{"label": "2-5 word title-case topic name", "email_ids": [0, 1, 2]}},
    ...
  ]
}}

Rules:
- Label should be a named entity, event, or clear theme (e.g. "OpenAI o3 Release", "AI Safety Research", "LLM Fine-tuning Techniques")
- Sort topics by number of emails descending
- If all emails are from different newsletters on different topics, prefer by-source grouping (use sender name as label)
- Never leave an email unassigned"""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                'https://openrouter.ai/api/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {OPENROUTER_API_KEY}',
                    'Content-Type': 'application/json',
                },
                json={
                    'model': MODEL,
                    'messages': [{'role': 'user', 'content': prompt}],
                },
            )
            resp.raise_for_status()
            content = resp.json()['choices'][0]['message'].get('content', '{}')

        match = re.search(r'\{[\s\S]*\}', content)
        raw = match.group(0) if match else '{}'
        data = json.loads(raw)

        clusters: list[list[int]] = []
        names: list[str] = []
        assigned: set[int] = set()

        for t in data.get('topics', []):
            label = t.get('label', 'General')
            ids   = [int(i) for i in t.get('email_ids', []) if 0 <= int(i) < len(emails)]
            if ids:
                clusters.append(ids)
                names.append(label)
                assigned.update(ids)

        # Any unassigned emails go into a catch-all cluster
        unassigned = [i for i in range(len(emails)) if i not in assigned]
        if unassigned:
            clusters.append(unassigned)
            names.append('Other Newsletters')

        # Sort by cluster size descending (LLM may not always sort correctly)
        paired = sorted(zip(clusters, names), key=lambda x: len(x[0]), reverse=True)
        if paired:
            clusters, names = zip(*paired)
            return list(clusters), list(names)
        return [], []

    except Exception:
        # Fallback: group by source
        return _group_by_source(emails)


async def _cluster_via_llm_batched(
    emails: list[dict],
    emit_event: Callable[[dict], Awaitable[None]] | None = None,
) -> tuple[list[list[int]], list[str]]:
    """Cluster emails into topic groups, splitting into CLUSTER_BATCH_SIZE-sized
    batches for large email counts instead of sending one giant prompt.

    An explicit "By topic" choice from the user is always honored — unlike the
    old AUTO_BY_SOURCE_THRESHOLD design (retired), which silently switched to
    by-source grouping above a fixed email count regardless of what the user
    asked for. Batching keeps every individual LLM prompt small (bounded by
    CLUSTER_BATCH_SIZE) no matter how large the total email count gets, so
    large Custom date ranges no longer need to fall back at all.

    Same-labeled clusters across batches are merged (case-insensitive,
    whitespace-normalized exact match) so the same topic doesn't fragment into
    several small per-batch clusters. This is a simple exact-match merge, not
    fuzzy/semantic matching — batches phrasing the same topic differently
    (e.g. "OpenAI GPT-5 Release" vs "OpenAI GPT-5 Launch") won't merge; a
    fuzzy/embedding-based merge pass is a possible future enhancement, not
    built here.
    """
    if len(emails) <= CLUSTER_BATCH_SIZE:
        return await _cluster_via_llm(emails)

    batches = [emails[i:i + CLUSTER_BATCH_SIZE] for i in range(0, len(emails), CLUSTER_BATCH_SIZE)]
    total_batches = len(batches)

    merged_clusters: list[list[int]] = []
    # label (normalized) -> index into merged_clusters, for exact-match merging
    label_index: dict[str, int] = {}
    merged_names: list[str] = []

    offset = 0
    for batch_num, batch in enumerate(batches, start=1):
        if emit_event:
            await emit_event({'type': 'searching', 'query': f'Clustering batch {batch_num}/{total_batches} ({len(batch)} emails)…'})

        batch_clusters, batch_names = await _cluster_via_llm(batch)

        for ids, name in zip(batch_clusters, batch_names):
            global_ids = [offset + i for i in ids]
            norm = name.strip().lower()
            if norm in label_index:
                merged_clusters[label_index[norm]].extend(global_ids)
            else:
                label_index[norm] = len(merged_clusters)
                merged_clusters.append(global_ids)
                merged_names.append(name)

        offset += len(batch)

    # Sort by cluster size descending, same convention as the single-batch path
    paired = sorted(zip(merged_clusters, merged_names), key=lambda x: len(x[0]), reverse=True)
    if not paired:
        return [], []
    clusters, names = zip(*paired)
    return list(clusters), list(names)


# ═══════════════════════════════════════════════════════════════════════════
# LLM SUMMARIZATION (replaces Anthropic SDK calls)
# ═══════════════════════════════════════════════════════════════════════════

async def _summarize_via_openrouter(
    emails: list[dict],
    emit_event: Callable[[dict], Awaitable[None]] | None = None,
) -> dict[int, str]:
    """Generate a 2-4 sentence summary for each email via OpenRouter.

    Returns {email_index: summary_text}.  Falls back to the raw Gmail snippet
    on any error or if the body is very short (< 200 chars).
    Processes up to 5 emails concurrently to stay within rate limits.
    Emits a progress event after each batch when there's more than one batch,
    so large digests (month range, many senders) show live progress instead
    of one static "Summarizing…" message for minutes.
    """
    if not OPENROUTER_API_KEY:
        return {}

    # URL-only / image-reference line pattern (mirrors gmail_tool.py)
    _url_line = re.compile(
        r'^(?:View image:\s*\(https?://[^)]+\)|https?://\S+|\[.*?\]\(https?://\S+\))$'
    )

    async def _summarize_one(idx: int, e: dict) -> tuple[int, str]:
        content = e['body'] or e['snippet']
        if len(content) < 200:
            return idx, e['snippet'] or content

        readable    = '\n'.join(ln for ln in content.split('\n') if not _url_line.match(ln.strip()))
        body_preview = readable[:3500]

        prompt = (
            'Summarize this newsletter/email with:\n'
            '1. A single bold headline sentence (the key takeaway)\n'
            '2. 3-4 bullet points with the most important specific details\n\n'
            'Format your response exactly like this:\n'
            '**[headline sentence here]**\n'
            '• [bullet point 1]\n'
            '• [bullet point 2]\n'
            '• [bullet point 3]\n\n'
            'Rules:\n'
            '- Be specific about what was reported or discussed\n'
            '- Do not start with "This article", "This email", or "This newsletter"\n'
            '- Each bullet must be a standalone fact or insight\n\n'
            f'Subject: {e["subject"]}\n'
            f'From: {sender_display(e["from"])}\n'
            f'Content:\n{body_preview}'
        )
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(
                    'https://openrouter.ai/api/v1/chat/completions',
                    headers={
                        'Authorization': f'Bearer {OPENROUTER_API_KEY}',
                        'Content-Type': 'application/json',
                    },
                    json={
                        'model': MODEL,
                        'max_tokens': 450,
                        'messages': [{'role': 'user', 'content': prompt}],
                    },
                )
                resp.raise_for_status()
                summary = resp.json()['choices'][0]['message'].get('content', '').strip()
                return idx, summary or e['snippet']
        except Exception:
            return idx, e['snippet'] or ''

    # Process in batches of 5 concurrent requests
    results: dict[int, str] = {}
    batch_size = 5
    for i in range(0, len(emails), batch_size):
        batch = [(i + j, emails[i + j]) for j in range(min(batch_size, len(emails) - i))]
        batch_results = await asyncio.gather(*[_summarize_one(idx, e) for idx, e in batch])
        results.update(batch_results)
        if emit_event and len(emails) > batch_size:
            await emit_event({'type': 'searching', 'query': f'Summarized {len(results)}/{len(emails)} emails…'})

    return results


# ═══════════════════════════════════════════════════════════════════════════
# DIGEST ASSEMBLY
# ═══════════════════════════════════════════════════════════════════════════

def _build_newsletter_digest(
    emails: list[dict],
    clusters: list[list[int]],
    cluster_names: list[str],
    summaries: dict[int, str],
    time_range: str,
    tz_name: str = 'UTC',
) -> NewsDigest:
    """Convert clustered + summarized emails into a NewsDigest."""
    topics: list[TopicCluster] = []

    for name, cluster in zip(cluster_names, clusters):
        articles: list[ArticleItem] = []
        for idx in cluster:
            e = emails[idx]
            url     = pick_primary_link(e['links'])
            excerpt = summaries.get(idx) or e['snippet'] or ''

            # Deduplicate up to 5 links (tracking links already filtered by extract_urls).
            # Uses dedup_key(), not a blind query-string strip — some senders (e.g.
            # AlphaSignal) route every distinct article through an identical-path
            # redirector and only differ by query param, so stripping the whole
            # query would collapse genuinely different articles into one.
            seen_norms: set[str] = set()
            deduped_links: list[str] = []
            for link in e['links']:
                norm = dedup_key(link)
                if norm not in seen_norms:
                    seen_norms.add(norm)
                    deduped_links.append(link)
                if len(deduped_links) >= 5:
                    break

            articles.append(ArticleItem(
                title          = e['subject'],
                url            = url,
                source         = sender_display(e['from']),
                published_date = format_header_date(e['date'], tz_name),
                excerpt        = excerpt,
                links          = deduped_links,
            ))
        if articles:
            topics.append(TopicCluster(
                label         = name,
                article_count = len(articles),
                articles      = articles,
            ))

    return NewsDigest(
        mode         = 'newsletter',
        time_range   = time_range,
        region       = None,
        generated_at = now_iso(),
        topics       = topics,
    )


# ═══════════════════════════════════════════════════════════════════════════
# MAIN ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════

async def run_gmail_digest(
    time_range: str,
    senders: list[str] | None,
    subject_kw: str | None,
    by_source: bool,
    emit_event: Callable[[dict], Awaitable[None]] | None,
    tz_name: str = 'UTC',
    start_date: str | None = None,
    end_date: str | None = None,
) -> NewsDigest:
    """Fetch, cluster, and summarize Gmail newsletter emails into a NewsDigest.

    Args:
        time_range:  'today' | 'yesterday' | 'week' | 'month' | 'custom'
        senders:     Optional list of sender email addresses to filter by.
        subject_kw:  Optional keyword to filter by subject line.
        by_source:   If True, group emails by sender instead of LLM topic clusters.
        emit_event:  Async callback for streaming search-progress events to the UI.
        tz_name:     IANA timezone name (e.g. 'America/Los_Angeles') used to resolve
                     'today'/'yesterday' day boundaries to the user's local calendar day.
        start_date:  'YYYY-MM-DD' — only used when time_range == 'custom'.
        end_date:    'YYYY-MM-DD' — only used when time_range == 'custom'; defaults
                     to start_date (single-day digest) when omitted.

    Returns:
        NewsDigest with mode='newsletter', topics populated from email clusters.
    """
    dates      = resolve_date_range(time_range, tz_name, start_date, end_date)
    start_iso  = dates['start']
    end_iso    = dates['end']

    empty_digest = NewsDigest(
        mode='newsletter',
        time_range=time_range,
        region=None,
        generated_at=now_iso(),
        topics=[],
    )

    # ── Step 1: Auth ────────────────────────────────────────────────────────
    if emit_event:
        await emit_event({'type': 'searching', 'query': 'Connecting to Gmail…'})

    try:
        service = await asyncio.to_thread(get_gmail_service)
    except FileNotFoundError as e:
        if emit_event:
            await emit_event({'type': 'error', 'message': str(e)})
        return empty_digest

    # ── Step 2: Resolve default senders from DB if none provided ────────────
    effective_senders = senders or []
    if not effective_senders:
        try:
            sources = await load_sources()
            effective_senders = sources.get('newsletters', [])
            if not effective_senders:
                if emit_event:
                    await emit_event({'type': 'error', 'message': 'No newsletter senders configured. Add sender domains via Manage Sources in the Newsletter panel.'})
                return empty_digest
        except Exception:
            if emit_event:
                await emit_event({'type': 'error', 'message': 'Could not load newsletter senders from database. Add senders in Manage Sources or check your database connection.'})
            return empty_digest

    # ── Step 3: Fetch emails ─────────────────────────────────────────────────
    query  = build_query(start_iso, end_iso, effective_senders, subject_kw or '')
    date_label = f"{start_iso[:10]} → {end_iso[:10]}"

    if emit_event:
        await emit_event({'type': 'searching', 'query': f'Gmail {date_label}'})

    emails, total_estimate = await asyncio.to_thread(fetch_emails, service, query)

    if emit_event:
        await emit_event({
            'type':  'results',
            'count': len(emails),
            'total': total_estimate,
            'query': f'Gmail ({len(emails)} of {total_estimate} email{"s" if total_estimate != 1 else ""})'
                     if total_estimate > len(emails)
                     else f'Gmail ({len(emails)} email{"s" if len(emails) != 1 else ""})',
        })

    if not emails:
        return empty_digest

    # ── Step 3: Tag matched emails with [gmail-ai-digested] ─────────────────
    try:
        label_id = await asyncio.to_thread(ensure_label, service, DIGESTED_LABEL)
        await asyncio.to_thread(apply_label_to_messages, service, [e['id'] for e in emails], label_id)
    except Exception:
        pass  # tagging failure is non-fatal

    # ── Step 4: Cluster ──────────────────────────────────────────────────────
    # The user's explicit by_source choice is always honored — large email
    # counts no longer force a silent fallback to by-source grouping (that
    # AUTO_BY_SOURCE_THRESHOLD design has been retired). Large "by topic"
    # requests are instead handled by batching the LLM clustering call — see
    # _cluster_via_llm_batched, which emits its own per-batch progress events.
    if emit_event:
        mode_label = 'by source' if by_source else 'by topic'
        await emit_event({'type': 'searching', 'query': f'Clustering {len(emails)} emails {mode_label}…'})

    if by_source:
        clusters, cluster_names = _group_by_source(emails)
    else:
        clusters, cluster_names = await _cluster_via_llm_batched(emails, emit_event)

    # ── Step 5: Summarize ────────────────────────────────────────────────────
    if emit_event:
        await emit_event({'type': 'searching', 'query': f'Summarizing {len(emails)} emails…'})

    summaries = await _summarize_via_openrouter(emails, emit_event)

    # ── Step 6: Assemble digest ──────────────────────────────────────────────
    return _build_newsletter_digest(emails, clusters, cluster_names, summaries, time_range, tz_name)
