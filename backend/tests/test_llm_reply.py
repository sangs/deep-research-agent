"""reply_text: a null/empty model reply must raise a clear error, never AttributeError.

Regression for 2026-11-13: `content: null` (thinking used up max_tokens) made every
newsletter summary fail with AttributeError and fall back to Gmail's preview text.
"""

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from services.llm import EmptyReplyError, describe_llm_error, reply_text  # noqa: E402


def _reply(content, finish='stop'):
    return {'model': 'google/test-model', 'choices': [{'finish_reason': finish, 'message': {'content': content}}]}


class ReplyTextTests(unittest.TestCase):
    def test_returns_stripped_text(self):
        self.assertEqual(reply_text(_reply('  **Headline**\n• one  ')), '**Headline**\n• one')

    def test_null_content_raises_empty_reply(self):
        with self.assertRaises(EmptyReplyError) as ctx:
            reply_text(_reply(None, finish='length'))
        self.assertIn('finish_reason=length', str(ctx.exception))
        self.assertIn('google/test-model', str(ctx.exception))

    def test_blank_or_missing_content_raises_empty_reply(self):
        for data in (_reply('   '), {'choices': [{'message': {}}]}, {'choices': []}, {}):
            with self.assertRaises(EmptyReplyError):
                reply_text(data)

    def test_user_facing_reason(self):
        self.assertEqual(describe_llm_error(EmptyReplyError('x')), 'the AI model returned no text')


if __name__ == '__main__':
    unittest.main()
