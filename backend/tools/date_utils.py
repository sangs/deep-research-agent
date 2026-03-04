from datetime import datetime, timezone, timedelta


def resolve_date_range(time_range: str) -> dict[str, str]:
    now = datetime.now(timezone.utc)
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
