"""finops_summary.build_summary: view payload -> /finops contract (design 16 §4.2), and the banner rules."""

import asyncio
import os
import pathlib
import sys
import unittest
from datetime import datetime, timezone
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from services import finops_summary  # noqa: E402
from services.finops_summary import FinopsUnavailable, build_summary  # noqa: E402

NOW = datetime(2026, 11, 16, 19, 0, tzinfo=timezone.utc)


def payload(mtd='2.4563', forecast='4.6056', threshold=25, stale=False):
    return {
        'totals': {'today': '2026-11-16', 'today_cost': '0.0008', 'month_to_date': mtd, 'last_month': '2.7006',
                   'forecast_month_end': forecast, 'threshold_usd': threshold},
        'by_provider': [{'provider': 'OpenRouter', 'sources': ['app_recorded'], 'month_to_date': '1.8542'}],
        'by_gcp_service': [{'service': 'Secret Manager', 'mtd': '0.5111'}],
        'daily': [{'date': '2026-11-15', 'provider': 'Google Cloud', 'cost': '0.035'}],
        'sources': [{'source': 'billing_export', 'provider': 'Google Cloud', 'as_of': '2026-11-16T15:01:13Z',
                     'is_stale': stale}],
        'app_recorded_since': '2026-10-08',
    }


class BuildSummaryTests(unittest.TestCase):
    def test_contract_shape_and_numbers(self):
        s = build_summary(payload(), 0.12, NOW)
        self.assertEqual(s['project'], 'gmail-digest')
        self.assertEqual(s['totals'], {'today': 0.0008, 'month_to_date': 2.4563, 'last_month': 2.7006,
                                       'forecast_month_end': 4.6056, 'threshold': 25.0, 'pct_of_threshold': 9.8})
        self.assertEqual(s['by_provider'], [{'provider': 'OpenRouter', 'mtd': 1.8542, 'sources': ['app_recorded']}])
        self.assertEqual(s['daily'], [{'date': '2026-11-15', 'provider': 'Google Cloud', 'cost': 0.035}])
        self.assertEqual(s['as_of'], {'billing_export': '2026-11-16T15:01:13Z'})
        self.assertEqual(s['live'], {'app_spend_today_utc': 0.12})
        self.assertEqual(s['untracked_before'], '2026-10-08')
        self.assertEqual(s['alerts'], [])

    def test_threshold_levels(self):
        warn = build_summary(payload(mtd='21', forecast='24'), None, NOW)['alerts']
        self.assertEqual([a['level'] for a in warn], ['warning'])
        self.assertIn('84%', warn[0]['message'])
        crit = build_summary(payload(mtd='26', forecast='40'), None, NOW)['alerts']
        self.assertEqual([a['level'] for a in crit], ['critical', 'warning'])

    def test_forecast_over_limit(self):
        alerts = build_summary(payload(mtd='5', forecast='30'), None, NOW)['alerts']
        self.assertEqual(len(alerts), 1)
        self.assertIn('forecast', alerts[0]['message'])

    def test_record_only_has_no_threshold_banners(self):
        s = build_summary(payload(mtd='500', forecast='900', threshold=None), None, NOW)
        self.assertIsNone(s['totals']['pct_of_threshold'])
        self.assertEqual(s['alerts'], [])

    def test_stale_source_banner(self):
        alerts = build_summary(payload(stale=True), None, NOW)['alerts']
        self.assertEqual(len(alerts), 1)
        self.assertIn('Google Cloud data is out of date', alerts[0]['message'])

    def test_live_unavailable_is_null(self):
        self.assertIsNone(build_summary(payload(), None, NOW)['live']['app_spend_today_utc'])


class SummaryTests(unittest.TestCase):
    def test_not_configured_raises_unavailable(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(FinopsUnavailable):
                asyncio.run(finops_summary.summary())

    def test_query_failure_becomes_unavailable(self):
        finops_summary._cache.clear()
        with mock.patch.dict(os.environ, {'FINOPS_PROJECT': 'p'}), \
             mock.patch.object(finops_summary, '_views_payload', side_effect=RuntimeError('boom')):
            with self.assertRaises(FinopsUnavailable):
                asyncio.run(finops_summary.summary())

    def test_cached_within_ttl(self):
        finops_summary._cache.clear()
        calls = []

        async def fake(project):
            calls.append(project)
            return payload()

        async def live():
            return 0.5

        with mock.patch.dict(os.environ, {'FINOPS_PROJECT': 'p'}), \
             mock.patch.object(finops_summary, '_views_payload', side_effect=fake), \
             mock.patch.object(finops_summary, '_live_app_today', side_effect=live):
            asyncio.run(finops_summary.summary())
            asyncio.run(finops_summary.summary())
            self.assertEqual(len(calls), 1)
            asyncio.run(finops_summary.summary(refresh=True))
            self.assertEqual(len(calls), 2)


if __name__ == '__main__':
    unittest.main()
