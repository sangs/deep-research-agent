from pydantic import BaseModel
from typing import Literal, Optional


class ArticleItem(BaseModel):
    title: str
    url: str
    source: str           # domain extracted from URL
    published_date: Optional[str] = None
    excerpt: str          # first 300 chars of text


class TopicCluster(BaseModel):
    label: str            # 2-6 words, title case, no verbs
    article_count: int
    articles: list[ArticleItem]


class NewsDigest(BaseModel):
    mode: str
    time_range: str
    region: Optional[str] = None
    generated_at: str     # ISO timestamp
    topics: list[TopicCluster]
