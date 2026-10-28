-- Default source lists: the template each user's own curated_sources is copied
-- from when their account becomes active (lib/users.ts), and what MCP callers
-- search. Migration 0007_per_user_identity already inserts this list; this file
-- is for resetting or extending the defaults. Safe to re-run.
-- Changing defaults affects only users activated afterwards.

INSERT INTO default_sources (domain, list_type) VALUES
  -- News Sites & Blogs (11)
  ('techcrunch.com',          'news_sites'),
  ('venturebeat.com',         'news_sites'),
  ('the-decoder.com',         'news_sites'),
  ('theverge.com',            'news_sites'),
  ('wired.com',               'news_sites'),
  ('infoq.com',               'news_sites'),
  ('thoughtworks.com',        'news_sites'),
  ('kdnuggets.com',           'news_sites'),
  ('towardsdatascience.com',  'news_sites'),
  ('news.ycombinator.com',    'news_sites'),
  ('unite.ai',                'news_sites'),
  -- Research Sites (9)
  ('openai.com',                  'research_sites'),
  ('anthropic.com',               'research_sites'),
  ('deepmind.google',             'research_sites'),
  ('ai.meta.com',                 'research_sites'),
  ('mistral.ai',                  'research_sites'),
  ('huggingface.co',              'research_sites'),
  ('paperswithcode.com',          'research_sites'),
  ('developers.googleblog.com',   'research_sites'),
  ('research.microsoft.com',      'research_sites'),
  -- Newsletter Senders (12) — used as Gmail from: wildcard filters
  ('sherwood.news',           'newsletters'),
  ('deepview.com',            'newsletters'),
  ('alphasignal.ai',          'newsletters'),
  ('lennysnewsletter.com',    'newsletters'),
  ('infoq.com',               'newsletters'),
  ('tldrnewsletter.com',      'newsletters'),
  ('superhuman.ai',           'newsletters'),
  ('genai.works',             'newsletters'),
  ('8020ai.co',               'newsletters'),
  ('llmwatch.com',            'newsletters'),
  ('medium.com',              'newsletters'),
  ('substack.com',            'newsletters'),
  ('globalai.community',      'newsletters'),
  ('llamaindex.ai',           'newsletters'),
  -- Global News Sites (15) — reputable, English-language outlets; gates the
  -- Global and Regional tabs' Exa include_domains so results stay in English
  -- and free of low-quality/spam domains (see
  -- documents/newshub_global_regional_reputable_sources_2026-08-27.md)
  ('ndtv.com',                 'global_news_sites'),
  ('thehindu.com',             'global_news_sites'),
  ('indianexpress.com',        'global_news_sites'),
  ('reuters.com',              'global_news_sites'),
  ('apnews.com',               'global_news_sites'),
  ('bbc.com',                  'global_news_sites'),
  ('nytimes.com',              'global_news_sites'),
  ('wsj.com',                  'global_news_sites'),
  ('bloomberg.com',            'global_news_sites'),
  ('theguardian.com',          'global_news_sites'),
  ('cnn.com',                  'global_news_sites'),
  ('npr.org',                  'global_news_sites'),
  ('axios.com',                'global_news_sites'),
  ('economist.com',            'global_news_sites'),
  ('aljazeera.com',            'global_news_sites')
ON CONFLICT (domain, list_type) DO NOTHING;
