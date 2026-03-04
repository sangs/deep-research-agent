import html as html_module
import os
import re
from exa_py import Exa
from dotenv import load_dotenv

load_dotenv()

_client: Exa | None = None

_PLACEHOLDER_DOMAINS = {'example.com', 'example.org', 'example.net', 'test.com', 'placeholder.com'}


def _clean_excerpt(text: str) -> str:
    """Strip markdown/HTML noise from Exa page text to produce a clean readable excerpt."""
    # Decode HTML entities (&amp; &#x27; etc.)
    text = html_module.unescape(text)
    # Remove images: ![alt](url)
    text = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', text)
    # Replace markdown links [text](url) with just the text
    text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', text)
    # Remove bare brackets up to 200 chars — catches nav/social items of any typical length
    text = re.sub(r'\[[^\]]{0,200}\]', '', text)
    # Strip any lone ] left behind after bracket removal
    text = text.replace(']', '')
    # Remove heading markers at line-start OR after whitespace (catches inline ## in collapsed text)
    text = re.sub(r'(^|[\s])#{1,6}\s+', r'\1', text, flags=re.MULTILINE)
    # Remove bold/italic markers (**text**, *text*, __text__, _text_)
    text = re.sub(r'(\*{1,3}|_{1,3})(.*?)\1', r'\2', text)
    # Remove trailing colon-asterisk patterns like :** or :***
    text = re.sub(r':\*+', ':', text)
    # Remove standalone asterisks/underscores used as bullets (* item)
    text = re.sub(r'(?<!\w)[*_](?!\w)', '', text)
    # Replace inline code with a space to prevent word fusion (`LangChain` → ' ')
    text = re.sub(r'`[^`]*`', ' ', text)
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    # Remove horizontal rules (--- or ***)
    text = re.sub(r'^[-*]{3,}\s*$', '', text, flags=re.MULTILINE)
    # Collapse multiple whitespace/newlines into a single space
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def _strip_leading_title(excerpt: str, title: str) -> str:
    """Remove a leading title echo from the excerpt so body content shows instead."""
    if not title or not excerpt:
        return excerpt
    norm_excerpt = excerpt.lstrip()
    if norm_excerpt.lower().startswith(title.lower()):
        remainder = re.sub(r'^[\s|–—:-]+', '', norm_excerpt[len(title):])
        if len(remainder) > 20:
            return remainder
    return excerpt


def _is_valid_url(url: str) -> bool:
    """Return True only for real http(s) URLs from non-placeholder domains."""
    if not url:
        return False
    if not url.startswith(('http://', 'https://')):
        return False
    try:
        domain = url.split('/')[2].lower().replace('www.', '')
        if domain in _PLACEHOLDER_DOMAINS:
            return False
    except Exception:
        return False
    return True


def get_exa_client() -> Exa:
    global _client
    if _client is None:
        api_key = os.getenv('EXA_API_KEY')
        if not api_key:
            raise ValueError('EXA_API_KEY environment variable is not set')
        _client = Exa(api_key=api_key)
    return _client


async def search_news(
    query: str,
    num_results: int,
    start_date: str | None = None,
    end_date: str | None = None,
    include_domains: list[str] | None = None,
    category: str | None = 'news',
) -> list[dict]:
    """Search Exa for news articles using the current search() API."""
    client = get_exa_client()

    kwargs: dict = {
        'num_results': num_results,
        'contents': {
            'text': {'maxCharacters': 300},
            # highlights: Exa picks the query-relevant sentences — avoids page chrome
            'highlights': {'numSentences': 2, 'highlightsPerUrl': 1},
        },
    }

    if start_date:
        kwargs['start_published_date'] = start_date
    if end_date:
        kwargs['end_published_date'] = end_date
    if category:
        kwargs['category'] = category

    if include_domains:
        kwargs['include_domains'] = include_domains

    try:
        results = client.search(query, **kwargs)
        articles = []
        for r in results.results:
            url = r.url or ''
            if not _is_valid_url(url):
                continue
            try:
                source = url.split('/')[2].replace('www.', '') if url else ''
            except Exception:
                source = ''
            articles.append({
                'title': r.title or '',
                'url': url,
                'source': source,
                'published_date': r.published_date,
                # Prefer highlights (query-aware), fall back to raw text — always run through cleaner
                'excerpt': _strip_leading_title(
                    _clean_excerpt((r.highlights or [None])[0] or r.text or ''),
                    r.title or '',
                )[:300],
            })
        return articles
    except Exception as e:
        raise RuntimeError(f'Exa search failed: {e}') from e
