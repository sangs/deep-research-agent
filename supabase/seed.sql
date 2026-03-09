-- Seed default curated sources for Blogs & Sites and Research tabs.
-- Safe to re-run: ON CONFLICT DO NOTHING skips existing rows.

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
  ('research.microsoft.com',      'research_sites')
ON CONFLICT (domain) DO NOTHING;
