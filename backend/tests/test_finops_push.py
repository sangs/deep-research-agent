"""finops_push: rows sent to finops-admin are daily aggregates with no user data, and the MERGE is well formed."""

import pathlib
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from services.finops_push import (  # noqa: E402
    NO_MODEL, PUSH_WINDOW_DAYS, merge_request, to_rows, window_start)


class FinopsPushTests(unittest.TestCase):
    def test_rows_use_finops_provider_names_and_fixed_decimals(self):
        rows = to_rows([('2026-11-16', 'openrouter', 'google/gemini-4-hydrogen', 0.0123),
                        ('2026-11-16', 'exa', None, 0.005)])
        self.assertEqual(rows[0], {'usage_date': '2026-11-16', 'provider': 'OpenRouter',
                                   'service': 'google/gemini-4-hydrogen', 'cost_usd': '0.012300000'})
        self.assertEqual(rows[1]['provider'], 'Exa')
        self.assertEqual(rows[1]['service'], NO_MODEL)

    def test_rows_carry_only_aggregate_fields(self):
        (row,) = to_rows([('2026-11-16', 'openrouter', 'm', 1)])
        self.assertEqual(set(row), {'usage_date', 'provider', 'service', 'cost_usd'})

    def test_window_starts_at_utc_midnight_and_includes_today(self):
        start = window_start(datetime(2026, 11, 16, 15, 30, tzinfo=timezone.utc))
        self.assertEqual(start, datetime(2026, 11, 16 - (PUSH_WINDOW_DAYS - 1), tzinfo=timezone.utc))

    def test_merge_request_shape(self):
        body = merge_request('proj', to_rows([('2026-11-16', 'openrouter', 'm', 0.5)]), '2026-11-10', 'run-1')
        self.assertIn('`proj.finops_landing.gmail_digest`', body['query'])
        self.assertIn('NOT MATCHED BY SOURCE AND t.usage_date >= @since THEN DELETE', body['query'])
        rows = body['queryParameters'][0]['parameterValue']['arrayValues']
        self.assertEqual(rows[0]['structValues']['cost_usd'], {'value': '0.500000000'})

    def test_empty_window_still_valid(self):
        body = merge_request('proj', [], '2026-11-10', 'run-1')
        self.assertEqual(body['queryParameters'][0]['parameterValue']['arrayValues'], [])


if __name__ == '__main__':
    unittest.main()
