"""Offline endpoint checks for reusing the exact displayed TKGM observation."""
import asyncio
from contextlib import ExitStack
from copy import deepcopy
import os
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

import httpx
import server
import web_research


REQUEST = {
    "province": "Yalova", "district": "Termal", "place": "Akköy",
    "place_kind": "köy", "block": "354", "parcel": "12", "zoning": "unknown",
}
SUBJECT = {
    "block": "354", "parcel": "12", "area": 381.25, "nature": "Arsa",
    "center": [40.64, 29.20], "source": "TKGM test fixture",
    "geometry": {"type": "Polygon", "coordinates": [[[29.2, 40.64], [29.201, 40.64], [29.2, 40.641], [29.2, 40.64]]]},
}
REAL_RESEARCH = web_research.research


class ResearchFlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(server.cache, {}, clear=True))
        self.stack.enter_context(patch.dict(server.research_contexts, {}, clear=True))
        self.stack.enter_context(patch.object(server, "gate", asyncio.Semaphore(2)))
        self.stack.enter_context(patch.object(web_research, "config_status", return_value={"configured": True}))
        self.stack.enter_context(patch.object(web_research, "authorized", return_value=True))
        self.provider = self.stack.enter_context(patch.object(web_research, "research", new_callable=AsyncMock))
        self.provider.return_value = {"status": "ok", "text": "Offline test fixture"}
        self.locate = self.stack.enter_context(patch.object(server, "locality", new_callable=AsyncMock))
        self.locate.return_value = "12345"
        self.parcel = self.stack.enter_context(patch.object(server, "parcel_data", new_callable=AsyncMock))
        self.parcel.side_effect = lambda *_: deepcopy(SUBJECT)
        self.stack.enter_context(patch.object(server, "search_source", new_callable=AsyncMock))
        self.stack.enter_context(patch.object(server, "research_snapshot", return_value=[]))
        self.network_calls = []

        def forbidden_network(request):
            self.network_calls.append(str(request.url))
            raise AssertionError("This endpoint test must never access an external service")

        self.stack.enter_context(patch.object(server, "client", side_effect=lambda: httpx.AsyncClient(transport=httpx.MockTransport(forbidden_network))))
        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
        self.addAsyncCleanup(self.http.aclose)

    async def analyze(self, request=None):
        response = await self.http.post("/api/analyze", json=request or REQUEST)
        self.assertEqual(response.status_code, 200)
        return response.json()

    async def research(self, context_id=None, **changes):
        request = dict(REQUEST, **changes)
        if context_id is not None:
            request["context_id"] = context_id
        response = await self.http.post("/api/research", json=request, headers={"X-Research-Code": "fixture-pilot-access-code"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("cache-control"), "no-store")
        return response.json()

    async def test_fresh_context_reuses_exact_displayed_subject_without_lookup(self):
        result = await self.analyze()
        context_id = result["research_context_id"]
        self.assertIsInstance(context_id, str)
        self.locate.reset_mock()
        self.parcel.reset_mock()
        # Browser-supplied parcel data is never accepted as an official observation.
        report = await self.research(context_id, subject={"area": 999999, "center": [0, 0]})
        self.assertEqual(report["status"], "ok")
        received = self.provider.await_args.kwargs["subject"]
        self.assertEqual(received, result["subject"])
        self.assertNotIn("context_id", self.provider.await_args.args[0])
        self.locate.assert_not_awaited()
        self.parcel.assert_not_awaited()
        self.assertEqual(self.network_calls, [])
        # Mutating a consumer's copy cannot change a later research observation.
        received["geometry"]["coordinates"][0][0][0] = 0
        await self.research(context_id)
        self.assertEqual(self.provider.await_args.kwargs["subject"], result["subject"])

    async def test_context_cannot_be_reused_for_different_parcel_or_zoning(self):
        result = await self.analyze()
        self.locate.reset_mock()
        self.parcel.reset_mock()
        for changes in ({"parcel": "13"}, {"place": "Hacımehmet"}, {"zoning": "field"}):
            with self.subTest(changes=changes):
                report = await self.research(result["research_context_id"], **changes)
                self.assertEqual(report["status"], "invalid_context")
                self.assertIn("yeniden sorgulayın", report["message"])
        self.provider.assert_not_awaited()
        self.locate.assert_not_awaited()
        self.parcel.assert_not_awaited()
        # A mismatched attempt does not destroy the original valid context.
        self.assertEqual((await self.research(result["research_context_id"]))["status"], "ok")

    async def test_expired_context_requires_a_new_parcel_query(self):
        now = 1000.0
        with patch.object(server, "time", SimpleNamespace(monotonic=lambda: now)):
            result = await self.analyze()
        self.locate.reset_mock()
        self.parcel.reset_mock()
        with patch.object(server, "time", SimpleNamespace(monotonic=lambda: now + server.RESEARCH_CONTEXT_TTL)):
            report = await self.research(result["research_context_id"])
        self.assertEqual(report["status"], "invalid_context")
        self.provider.assert_not_awaited()
        self.locate.assert_not_awaited()
        self.parcel.assert_not_awaited()

    async def test_bounded_context_cache_expires_old_observation_safely(self):
        with patch.object(server, "MAX_RESEARCH_CONTEXTS", 2):
            first = await self.analyze()
            second = await self.analyze()
            third = await self.analyze()
        self.assertEqual((await self.research(first["research_context_id"]))["status"], "invalid_context")
        self.assertEqual((await self.research(second["research_context_id"]))["status"], "ok")
        self.assertEqual((await self.research(third["research_context_id"]))["status"], "ok")

    async def test_missing_or_invalid_auth_never_accesses_context_or_network(self):
        for configured, expected in ((False, "not_configured"), (True, "unauthorized")):
            env = {"GEMINI_API_KEY": "fixture-not-a-real-key", "GOOGLE_RESEARCH_ACCESS_TOKEN": "fixture-expected-code-at-least-24-characters"} if configured else {}
            with self.subTest(expected=expected), patch.dict(os.environ, env, clear=True), \
                 patch.object(web_research, "config_status", return_value={"configured": configured}), \
                 patch.object(web_research, "authorized", return_value=False), \
                 patch.object(web_research, "research", REAL_RESEARCH), \
                 patch.object(server, "research_context_subject", side_effect=AssertionError("Check auth before context")), \
                 patch.object(httpx, "AsyncClient", side_effect=AssertionError("No network before auth")):
                report = await self.research("unknown-context-id-123456789")
                self.assertEqual(report["status"], expected)
        self.locate.assert_not_awaited()
        self.parcel.assert_not_awaited()

    async def test_manual_report_without_context_keeps_trusted_lookup(self):
        report = await self.research()
        self.assertEqual(report["status"], "ok")
        self.locate.assert_awaited_once()
        self.parcel.assert_awaited_once()
        self.assertEqual(self.provider.await_args.kwargs["subject"], SUBJECT)

    async def test_failed_parcel_lookup_does_not_create_a_context(self):
        self.parcel.side_effect = ValueError("Fixture parcel unavailable")
        result = await self.analyze()
        self.assertIsNone(result["subject"])
        self.assertIsNone(result["research_context_id"])
        self.assertEqual(server.research_contexts, {})


if __name__ == "__main__":
    unittest.main()
