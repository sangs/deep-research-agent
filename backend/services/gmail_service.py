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
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Callable, Awaitable
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv

from models.schemas import NewsDigest, TopicCluster, ArticleItem
from tools.date_utils import resolve_date_range
from tools.news_tools import load_sources

load_dotenv()

OPENROUTER_API_KEY = os.getenv('OPENROUTER_API_KEY', '')
MODEL = 'google/gemini-2.0-flash-001'

# Gmail label constants
DIGESTED_LABEL = 'gmail-ai-digested'   # applied to every matched email
DIGEST_FOLDER  = 'Digest'              # used by standalone tool; kept for reference

# Gmail OAuth scopes — modify permission allows labelling matched emails
SCOPES = ['https://www.googleapis.com/auth/gmail.modify']

# URL patterns to skip when picking a citation link (tracking/management links)
_URL_SKIP = (
    'unsubscribe', 'optout', 'opt-out', 'manage', 'preferences',
    'pixel', 'beacon', 'track', 'click.', 'open.', 'list-manage',
    'mailchimp', 'sendgrid', 'constantcontact', 'campaign-archive',
    '.gif', '.png', '.jpg', '.ico', 'mailto:',
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


def extract_urls(text: str) -> list[str]:
    """Extract http(s) URLs from plain text, filtering out tracking/utility links."""
    raw = re.findall(r'https?://[^\s<>"{}|\\^`\[\]]*[^\s<>"{}|\\^`\[\].,;:!?]', text)
    return [u for u in raw if not any(s in u.lower() for s in _URL_SKIP)]


def pick_primary_link(urls: list[str]) -> str:
    """Return the most article-like URL — prefers longer paths, deduplicates."""
    seen, unique = set(), []
    for u in urls:
        norm = u.split('?')[0].rstrip('/')
        if norm not in seen:
            seen.add(norm)
            unique.append(u)
    if not unique:
        return ''
    meaningful = [u for u in unique if len(urlparse(u).path.strip('/')) > 3]
    candidates = meaningful or unique
    return max(candidates, key=lambda u: len(urlparse(u).path))


def sender_display(from_header: str) -> str:
    """Extract the display name from a From header ('Name <email@domain.com>')."""
    m = re.match(r'^"?([^"<]+)"?\s*<', from_header)
    if m:
        return m.group(1).strip()
    m2 = re.match(r'^([^@]+)@', from_header)
    if m2:
        return m2.group(1).strip()
    return from_header.strip()


def format_date(raw: str) -> str:
    """Parse an RFC 2822 date header into a readable string."""
    try:
        return parsedate_to_datetime(raw).strftime('%Y-%m-%d')
    except Exception:
        return raw


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


def fetch_emails(service, query: str, max_results: int = 200) -> list[dict]:
    """Fetch full email objects matching query (sync — call via asyncio.to_thread)."""
    messages, page_token = [], None
    while True:
        kwargs = {'userId': 'me', 'q': query, 'maxResults': min(max_results, 100)}
        if page_token:
            kwargs['pageToken'] = page_token
        resp = service.users().messages().list(**kwargs).execute()
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
        links   = extract_urls(body) + extract_urls(full.get('snippet', ''))
        emails.append({
            'id':      msg['id'],
            'subject': headers.get('subject', '(no subject)'),
            'from':    headers.get('from', ''),
            'date':    headers.get('date', ''),
            'body':    _clean_snippet(body),
            'snippet': _clean_snippet(full.get('snippet', '')),
            'links':   links,
        })

    return emails


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


# ═══════════════════════════════════════════════════════════════════════════
# LLM SUMMARIZATION (replaces Anthropic SDK calls)
# ═══════════════════════════════════════════════════════════════════════════

async def _summarize_via_openrouter(emails: list[dict]) -> dict[int, str]:
    """Generate a 2-4 sentence summary for each email via OpenRouter.

    Returns {email_index: summary_text}.  Falls back to the raw Gmail snippet
    on any error or if the body is very short (< 200 chars).
    Processes up to 5 emails concurrently to stay within rate limits.
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
) -> NewsDigest:
    """Convert clustered + summarized emails into a NewsDigest."""
    topics: list[TopicCluster] = []

    for name, cluster in zip(cluster_names, clusters):
        articles: list[ArticleItem] = []
        for idx in cluster:
            e = emails[idx]
            url     = pick_primary_link(e['links'])
            excerpt = summaries.get(idx) or e['snippet'] or ''

            # Deduplicate up to 5 links (tracking links already filtered by extract_urls)
            seen_norms: set[str] = set()
            deduped_links: list[str] = []
            for link in e['links']:
                norm = link.split('?')[0].rstrip('/')
                if norm not in seen_norms:
                    seen_norms.add(norm)
                    deduped_links.append(link)
                if len(deduped_links) >= 5:
                    break

            articles.append(ArticleItem(
                title          = e['subject'],
                url            = url,
                source         = sender_display(e['from']),
                published_date = format_date(e['date']),
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
        generated_at = datetime.now(timezone.utc).isoformat(),
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
) -> NewsDigest:
    """Fetch, cluster, and summarize Gmail newsletter emails into a NewsDigest.

    Args:
        time_range:  'today' | 'yesterday' | 'week' | 'month'
        senders:     Optional list of sender email addresses to filter by.
        subject_kw:  Optional keyword to filter by subject line.
        by_source:   If True, group emails by sender instead of LLM topic clusters.
        emit_event:  Async callback for streaming search-progress events to the UI.

    Returns:
        NewsDigest with mode='newsletter', topics populated from email clusters.
    """
    dates      = resolve_date_range(time_range)
    start_iso  = dates['start']
    end_iso    = dates['end']

    empty_digest = NewsDigest(
        mode='newsletter',
        time_range=time_range,
        region=None,
        generated_at=datetime.now(timezone.utc).isoformat(),
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

    emails = await asyncio.to_thread(fetch_emails, service, query)

    if emit_event:
        await emit_event({
            'type':  'results',
            'count': len(emails),
            'query': f'Gmail ({len(emails)} email{"s" if len(emails) != 1 else ""})',
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
    if emit_event:
        mode_label = 'by source' if by_source else 'by topic'
        await emit_event({'type': 'searching', 'query': f'Clustering {len(emails)} emails {mode_label}…'})

    if by_source:
        clusters, cluster_names = _group_by_source(emails)
    else:
        clusters, cluster_names = await _cluster_via_llm(emails)

    # ── Step 5: Summarize ────────────────────────────────────────────────────
    if emit_event:
        await emit_event({'type': 'searching', 'query': f'Summarizing {len(emails)} emails…'})

    summaries = await _summarize_via_openrouter(emails)

    # ── Step 6: Assemble digest ──────────────────────────────────────────────
    return _build_newsletter_digest(emails, clusters, cluster_names, summaries, time_range)
