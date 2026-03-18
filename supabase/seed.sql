-- Seed default curated sources for Blogs & Sites, Research, and Newsletter tabs.
-- Safe to re-run: ON CONFLICT (domain, list_type) DO NOTHING skips existing rows.
--
-- PREREQUISITE: unique constraint must be on (domain, list_type), not just (domain).
-- Run this migration once before seeding if it hasn't been applied yet:
--
--   ALTER TABLE curated_sources
--     DROP CONSTRAINT IF EXISTS curated_sources_domain_unique;
--   ALTER TABLE curated_sources
--     ADD CONSTRAINT curated_sources_domain_list_type_unique UNIQUE (domain, list_type);

INSERT INTO curated_sources (domain, list_type) VALUES
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
  ('llamaindex.ai',           'newsletters')
ON CONFLICT (domain, list_type) DO NOTHING;
