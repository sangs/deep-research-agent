from datetime import datetime, timezone, timedelta, tzinfo
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def resolve_tz(tz_name: str = 'UTC') -> tzinfo:
    """Resolve an IANA timezone name to a tzinfo, falling back to UTC for
    unknown/invalid names. Single source of truth for this pattern — used by
    both resolve_date_range() and format_header_date() below."""
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def resolve_date_range(time_range: str, tz_name: str = 'UTC') -> dict[str, str]:
    tz = resolve_tz(tz_name)
    now = datetime.now(tz)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    match time_range:
        case 'today':
            return {'start': today_start.isoformat(), 'end': now.isoformat()}
        case 'yesterday':
            yday = today_start - timedelta(days=1)
            return {'start': yday.isoformat(), 'end': today_start.isoformat()}
        case 'week':
            return {'start': (today_start - timedelta(days=7)).isoformat(), 'end': now.isoformat()}
        case 'month':
            return {'start': (today_start - timedelta(days=30)).isoformat(), 'end': now.isoformat()}
        case _:
            return {'start': (today_start - timedelta(days=7)).isoformat(), 'end': now.isoformat()}


def format_header_date(raw: str, tz_name: str = 'UTC') -> str:
    """Parse an RFC 2822 date header (e.g. an email Date: header) and format it
    as YYYY-MM-DD in the reader's timezone.

    The header carries whatever UTC offset the *sender* stamped on it (often a
    digest's composition time, e.g. late the previous evening, rather than the
    reader's actual delivery day) — converting to tz_name before formatting
    keeps the displayed date aligned with the reader's local calendar day
    instead of leaking the sender's.
    """
    try:
        dt = parsedate_to_datetime(raw)
        return dt.astimezone(resolve_tz(tz_name)).strftime('%Y-%m-%d')
    except Exception:
        return raw


def now_iso() -> str:
    """Current UTC instant as an ISO-8601 string — for 'generated_at' digest
    timestamps (a distinct 'current instant' concern, unrelated to the
    day-boundary math in resolve_date_range)."""
    return datetime.now(timezone.utc).isoformat()
