"""Fast, offline integration regressions for research lifecycle and locality.

All HTTP responses are provided by httpx.MockTransport. These tests never
contact listing providers or TKGM, and never create real research observations.
"""
import asyncio
import unittest
import urllib.robotparser
from unittest.mock import patch

import httpx
import server


REQUEST = server.Req(province="Yalova", district="Merkez", place="Hacımehmet",
                     block="1295", parcel="4")
EMLAKJET = "https://www.emlakjet.com"


def record(url, place="Hacımehmet", source="Emlakjet", detail=True):
    return server.item_record(
        "Test fixture: satılık arsa", url, 500, 5000000, "residential",
        "1" if detail else None, "1" if detail else None,
        source=source, live=detail, detail_verified=detail,
        address={"province": "Yalova", "district": "Merkez", "place": place},
    )


async def locality(_client, request):
    return {"Hacımehmet": "100", "Kazım Karabekir Mah.": "200"}[request.place]


async def parcel(_client, locality_id, block, parcel_number):
    return {"block": block, "parcel": parcel_number, "area": 500,
            "nature": "Arsa", "center": [40.64, 29.25 if locality_id == "100" else 29.255],
            "geometry": {}, "source": "TKGM test fixture"}


class ResearchPipelineTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cache_patch = patch.dict(server.cache, {}, clear=True)
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)

    async def test_json_retry_is_bounded_and_never_caches_failures(self):
        cases = [
            ("transient-503", [503, 200], False, 2),
            ("transient-timeout", ["timeout", 200], False, 2),
            ("forbidden", [403, 200], True, 1),
            ("rate-limited", [429, 200], True, 1),
            ("missing", [404, 200], True, 1),
            ("repeated-503", [503, 503, 200], True, 2),
        ]
        for name, responses, initially_fails, initial_calls in cases:
            with self.subTest(case=name):
                url = server.TKGM + "/test-fixture/" + name
                calls = []
                payload = {"fixture": name, "recovered": True}

                async def handler(request):
                    calls.append(str(request.url))
                    outcome = responses[len(calls) - 1]
                    if outcome == "timeout":
                        raise httpx.ReadTimeout("Simulated transient timeout", request=request)
                    return httpx.Response(outcome, json=payload if outcome == 200 else {"error": "fixture"})

                async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                    if initially_fails:
                        with self.assertRaises(httpx.HTTPStatusError):
                            await server.getjson(client, url)
                        self.assertEqual(len(calls), initial_calls)
                        self.assertNotIn(url, server.cache)
                        # A separate caller may retry later; the prior error is
                        # neither cached nor turned into a successful response.
                        self.assertEqual(await server.getjson(client, url), payload)
                        successful_calls = initial_calls + 1
                    else:
                        self.assertEqual(await server.getjson(client, url), payload)
                        successful_calls = initial_calls
                    self.assertEqual(len(calls), successful_calls)
                    self.assertEqual(server.cache[url][1], payload)
                    self.assertEqual(await server.getjson(client, url), payload)
                    self.assertEqual(len(calls), successful_calls)

    async def test_outer_timeout_preserves_completed_rows_and_source_status(self):
        detail_read = asyncio.Event()
        never_finishes = asyncio.Event()
        good = EMLAKJET + "/ilan/good-12345"
        slow = EMLAKJET + "/ilan/slow-54321"

        async def handler(request):
            url = str(request.url)
            if url.endswith("robots.txt"):
                return httpx.Response(200, text="User-agent: *\nAllow: /")
            if url == slow:
                await never_finishes.wait()
            return httpx.Response(200, text="fixture page")

        def client():
            return httpx.AsyncClient(transport=httpx.MockTransport(handler))

        def candidates(_html, _url, _request, source):
            return {good: None, slow: None} if source == "Emlakjet" else {}

        def read_detail(_html, url, _request, _source):
            detail_read.set()
            return record(url)

        original_wait_for = asyncio.wait_for

        async def controlled_timeout(awaitable, timeout):
            if timeout != 55:
                return await original_wait_for(awaitable, timeout)
            task = asyncio.ensure_future(awaitable)
            # Cancel only once a detail has completed, avoiding a timing race.
            await original_wait_for(detail_read.wait(), 2)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                raise TimeoutError from None
            raise AssertionError("The unfinished detail request was not cancelled")

        with patch.object(server, "client", client), \
             patch.object(server, "locality", locality), \
             patch.object(server, "parcel_data", parcel), \
             patch.object(server.listing_readers, "search_urls", lambda req, source: [server.SOURCES[source] + "/category"]), \
             patch.object(server.listing_readers, "candidates", candidates), \
             patch.object(server, "parse_detail", read_detail), \
             patch.object(server.asyncio, "wait_for", controlled_timeout):
            result = await server.analyze(REQUEST)

        self.assertEqual([row["url"] for row in result["items"]], [good])
        statuses = {s["source"]: s for s in result["source_status"]}
        self.assertEqual(set(statuses), {"RE/MAX", "Emlakjet"})
        self.assertEqual(statuses["Emlakjet"]["details_read"], 1)
        self.assertEqual(statuses["Emlakjet"]["status"], "partial")
        self.assertTrue(any("tamamlanan okumalar" in note for note in statuses["Emlakjet"]["notes"]))

    async def test_category_access_restriction_stops_further_source_requests(self):
        good_category = EMLAKJET + "/satilik-arsa/yalova-merkez-hacimehmet-koyu"
        blocked_category = EMLAKJET + "/satilik-arsa/yalova-merkez"
        detail = EMLAKJET + "/ilan/test-12345"

        for status_code in (403, 429):
            with self.subTest(status=status_code):
                server.cache.clear()
                calls = []

                async def handler(request):
                    url = str(request.url)
                    calls.append(url)
                    if url.endswith("robots.txt"):
                        return httpx.Response(200, text="User-agent: *\nAllow: /")
                    if url == blocked_category:
                        return httpx.Response(status_code)
                    if url == good_category:
                        return httpx.Response(200, text="fixture search page")
                    raise AssertionError("Request made after source restriction: " + url)

                with patch.object(server.listing_readers, "search_urls", lambda *args: [good_category, blocked_category]), \
                     patch.object(server.listing_readers, "candidates", lambda *args: {detail: record(detail, detail=False)}):
                    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                        rows, stats = await server.search_source(client, REQUEST, "Emlakjet")

                self.assertEqual(calls, [EMLAKJET + "/robots.txt", good_category, blocked_category])
                self.assertEqual(stats["status"], "restricted")
                self.assertEqual(stats["details_attempted"], 0)
                self.assertFalse(any(row.get("detail_verified") for row in rows))

    async def test_own_locality_is_used_and_same_numbers_in_other_locality_survive(self):
        lookups = []

        async def track_parcel(client, locality_id, block, parcel_number):
            lookups.append((locality_id, block, parcel_number))
            return await parcel(client, locality_id, block, parcel_number)

        async def search(_client, _request, source, progress=None, output=None):
            if source == "RE/MAX":
                rows = [record("https://remax.com.tr/tr/portfoy/P10000001", source=source),
                        record("https://remax.com.tr/tr/portfoy/P10000002", "Kazım Karabekir Mah.", source=source)]
            else:
                rows = [record(EMLAKJET + "/ilan/duplicate-12345")]
            progress.update(source=source, details_read=len(rows), status="ok")
            output.extend(rows)
            return output, progress

        with patch.object(server, "locality", locality), \
             patch.object(server, "parcel_data", track_parcel), \
             patch.object(server, "search_source", search):
            result = await server.analyze(REQUEST)

        self.assertIn(("100", "1", "1"), lookups)
        self.assertIn(("200", "1", "1"), lookups)
        self.assertEqual(len(result["items"]), 2)
        by_locality = {row["locality_id"]: row for row in result["items"]}
        self.assertEqual(set(by_locality), {"100", "200"})
        self.assertEqual(len(by_locality["100"]["source_urls"]), 2)
        self.assertNotEqual(by_locality["100"]["center"], by_locality["200"]["center"])

    async def test_redirect_target_access_rules_checked_before_fetch(self):
        calls = []
        rules = urllib.robotparser.RobotFileParser()
        rules.parse(["User-agent: *", "Disallow: /private"])

        async def handler(request):
            calls.append(str(request.url))
            return httpx.Response(302, headers={"Location": "/private"})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with self.assertRaises(PermissionError):
                await server.source_get(client, EMLAKJET + "/start", EMLAKJET, rules)
        self.assertEqual(calls, [EMLAKJET + "/start"])

    async def test_missing_category_falls_back_and_missing_detail_is_dropped(self):
        good = EMLAKJET + "/ilan/good-12345"
        missing = EMLAKJET + "/ilan/missing-54321"

        async def handler(request):
            url = str(request.url)
            if url.endswith("robots.txt"):
                return httpx.Response(200, text="User-agent: *\nAllow: /")
            if url in {EMLAKJET + "/missing-category", missing}:
                return httpx.Response(404)
            return httpx.Response(200, text="fixture page")

        with patch.object(server.listing_readers, "search_urls", lambda *args: [EMLAKJET + "/missing-category", EMLAKJET + "/good-category"]), \
             patch.object(server.listing_readers, "candidates", lambda *args: {good: record(good, detail=False), missing: record(missing, detail=False)}), \
             patch.object(server, "parse_detail", lambda *args: record(good)):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                rows, stats = await server.search_source(client, REQUEST, "Emlakjet")

        self.assertEqual([row["url"] for row in rows], [good])
        self.assertEqual(stats["unavailable"], 1)
        self.assertEqual(stats["details_read"], 1)


if __name__ == "__main__":
    unittest.main()
