"""Offline research integration tests: only MockTransport may answer requests."""
import asyncio
import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
import web_research as research

ACCESS = "fixture-access-code-at-least-24-characters"
KEY = "fixture-google-api-key-not-a-real-credential"
REQUEST = {"province": "Yalova", "district": "Termal", "place": "Akköy", "block": "354", "parcel": "12", "zoning": "unknown"}
SUBJECT = {"area": 381.0, "nature": "Arsa", "block": "354", "parcel": "12", "center": [40.64, 29.20], "source": "TKGM test fixture"}
NOW = datetime(2026, 11, 27, 12, 0, tzinfo=timezone.utc)
HTML = '<style>.chip{color:#123}</style><a href="https://www.google.com/search?q=Akk%C3%B6y">Google araması</a>'


def response_payload():
    text = "Akköy 🌊: araştırma örneği."
    return {
        "candidates": [{
            "content": {"parts": [{"text": text}]},
            "finishReason": "STOP",
            "groundingMetadata": {
                "groundingChunks": [{"web": {"uri": "https://www.example.com/arsa/1", "title": "Test fixture"}}],
                "groundingSupports": [{"segment": {"startIndex": 0, "endIndex": len(text.encode("utf-8")), "text": text}, "groundingChunkIndices": [0]}],
                "searchEntryPoint": {"renderedContent": HTML},
                "webSearchQueries": ["Yalova Termal Akköy satılık arsa"],
            },
        }],
    }


class WebResearchTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.patches = [
            patch.dict(os.environ, {"GEMINI_API_KEY": KEY, "GOOGLE_RESEARCH_ACCESS_TOKEN": ACCESS}, clear=True),
            patch.object(research, "_request_lock", asyncio.Semaphore(1)),
            patch.object(research, "_request_day", None),
            patch.object(research, "_daily_requests", 0),
            patch.object(research, "_now", lambda: NOW),
        ]
        for value in self.patches:
            value.start()
            self.addCleanup(value.stop)

    async def query(self, payload=None, status=200, handler=None):
        async def default_handler(request):
            return httpx.Response(status, json=payload if payload is not None else response_payload())
        return await research.research(REQUEST, SUBJECT, ACCESS, transport=httpx.MockTransport(handler or default_handler))

    async def test_missing_credentials_or_invalid_model_never_make_a_request(self):
        def forbidden(_request):
            raise AssertionError("An unconfigured provider must not be contacted")
        cases = [
            {"GEMINI_API_KEY": ""},
            {"GOOGLE_RESEARCH_ACCESS_TOKEN": ""},
            {"GOOGLE_RESEARCH_ACCESS_TOKEN": "short"},
            {"GEMINI_MODEL": "gemini-x/../../other"},
            {"GEMINI_MODEL": "https://other.example/model"},
        ]
        for env in cases:
            with self.subTest(env_names=list(env)), patch.dict(os.environ, env):
                self.assertFalse(research.config_status()["configured"])
                result = await self.query(handler=forbidden)
                self.assertEqual(result["status"], "not_configured")
        self.assertEqual(research._daily_requests, 0)

    async def test_access_code_required_and_never_sent_to_google(self):
        def forbidden(_request):
            raise AssertionError("Unauthorized callers must not contact Google")
        for value in (None, "wrong", 123, "ı" * 32):
            result = await research.research(REQUEST, SUBJECT, value, transport=httpx.MockTransport(forbidden))
            self.assertEqual(result["status"], "unauthorized")
        self.assertTrue(research.authorized(ACCESS))
        public = json.dumps(research.config_status())
        self.assertNotIn(ACCESS, public)
        self.assertNotIn(KEY, public)
        self.assertEqual(research._daily_requests, 0)

    async def test_one_google_request_only_and_required_grounding_preserved(self):
        calls = []
        payload = response_payload()

        def handler(request):
            calls.append(request)
            self.assertEqual(request.url.host, "generativelanguage.googleapis.com")
            self.assertEqual(request.url.path, "/v1beta/models/gemini-3.5-flash-lite:generateContent")
            self.assertEqual(request.method, "POST")
            self.assertEqual(request.headers["x-goog-api-key"], KEY)
            self.assertEqual(request.url.query, b"")
            body = json.loads(request.content)
            self.assertEqual(body["tools"], [{"google_search": {}}])
            self.assertNotIn(ACCESS, request.content.decode())
            self.assertNotIn(KEY, request.content.decode())
            self.assertIn('"area_m2": 381.0', body["contents"][0]["parts"][0]["text"])
            return httpx.Response(200, json=payload)

        result = await self.query(handler=handler)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["search_suggestions_html"], HTML)
        self.assertEqual(result["grounding_metadata"], payload["candidates"][0]["groundingMetadata"])
        self.assertEqual(result["text"], "Akköy 🌊: araştırma örneği.")
        self.assertEqual("".join(f["text"] for f in result["fragments"]), result["text"])
        self.assertEqual(result["fragments"][0]["citation_indices"], [0])
        self.assertEqual(result["sources"][0]["index"], 0)
        self.assertEqual(research._daily_requests, 1)
        self.assertNotIn("estimate", result)
        self.assertNotIn("items", result)

    async def test_safe_error_messages_and_no_automatic_retry(self):
        for status, expected in ((401, "provider_error"), (403, "provider_error"), (429, "rate_limited"), (500, "provider_error")):
            calls = []

            def handler(request):
                calls.append(request)
                return httpx.Response(status, json={"error": {"message": KEY + ACCESS}})

            with self.subTest(status=status):
                result = await self.query(handler=handler)
                self.assertEqual(result["status"], expected)
                self.assertEqual(len(calls), 1)
                self.assertNotIn(KEY, json.dumps(result))
                self.assertNotIn(ACCESS, json.dumps(result))

    async def test_timeout_returns_without_retry(self):
        calls = []

        def handler(request):
            calls.append(request)
            raise httpx.ReadTimeout(KEY + ACCESS, request=request)

        result = await self.query(handler=handler)
        self.assertEqual(result["status"], "timeout")
        self.assertEqual(len(calls), 1)
        self.assertNotIn(KEY, json.dumps(result))

    async def test_redirect_is_not_followed(self):
        calls = []

        def handler(request):
            calls.append(str(request.url))
            return httpx.Response(302, headers={"Location": "https://www.sahibinden.com/ilan/fixture"})

        result = await self.query(handler=handler)
        self.assertEqual(result["status"], "provider_error")
        self.assertEqual(len(calls), 1)

    async def test_busy_request_does_not_queue_or_consume_an_allowance(self):
        started, finish = asyncio.Event(), asyncio.Event()

        async def handler(_request):
            started.set()
            await finish.wait()
            return httpx.Response(200, json=response_payload())

        first = asyncio.create_task(self.query(handler=handler))
        await asyncio.wait_for(started.wait(), 1)
        try:
            second = await self.query(handler=lambda request: self.fail("A second request was sent"))
            self.assertEqual(second["status"], "busy")
            self.assertEqual(research._daily_requests, 1)
        finally:
            finish.set()
        self.assertEqual((await first)["status"], "ok")

    async def test_daily_allowance_is_process_local_and_resets_on_utc_date(self):
        research._request_day, research._daily_requests = NOW.date(), 19
        self.assertEqual((await self.query())["status"], "ok")
        result = await self.query(handler=lambda request: self.fail("Daily limit did not stop request"))
        self.assertEqual(result["status"], "quota_exceeded")
        self.assertEqual(research._daily_requests, 20)
        with patch.object(research, "_now", lambda: NOW + timedelta(days=1)):
            self.assertEqual((await self.query())["status"], "ok")
        self.assertEqual(research._daily_requests, 1)

    async def test_missing_grounding_or_suggestions_is_not_verified(self):
        for missing in ("groundingChunks", "groundingSupports", "searchEntryPoint"):
            payload = response_payload()
            del payload["candidates"][0]["groundingMetadata"][missing]
            with self.subTest(missing=missing):
                result = await self.query(payload)
                self.assertEqual(result["status"], "no_grounding")
                self.assertTrue(result["text"])
                self.assertEqual(result["sources"], [])
                self.assertEqual(result["search_suggestions_html"], "")

    async def test_unsafe_source_urls_and_html_are_not_returned(self):
        unsafe = ["javascript:alert(1)", "http://example.com/", "https://127.0.0.1/", "https://8.8.8.8/", "https://[::1]/", "https://localhost/", "https://a.internal/", "https://user:pass@example.com/", "https://2130706433/", "https://0x7f.0.0.1/", "https://example.com:8443/"]
        for url in unsafe:
            payload = response_payload()
            payload["candidates"][0]["groundingMetadata"]["groundingChunks"][0]["web"]["uri"] = url
            with self.subTest(url=url):
                result = await self.query(payload)
                self.assertEqual(result["status"], "no_grounding")
                self.assertEqual(result["sources"], [])
                self.assertIsNone(result["grounding_metadata"])
        research._daily_requests = 0
        for html in ('<a href="java&#x73;cript:alert(1)">x</a>', '<script>alert(1)</script>' + HTML, HTML + '<img src="https://127.0.0.1/a">', HTML + '<svg onload="alert(1)"></svg>', HTML + '<style>x{background:url(https://10.0.0.1/a)}</style>'):
            payload = response_payload()
            payload["candidates"][0]["groundingMetadata"]["searchEntryPoint"]["renderedContent"] = html
            with self.subTest(html=html):
                result = await self.query(payload)
                self.assertEqual(result["status"], "no_grounding")
                self.assertEqual(result["search_suggestions_html"], "")

    async def test_full_provider_text_is_never_silently_truncated(self):
        payload = response_payload()
        suffix = " Ek kaynak açıklaması." * 1000
        payload["candidates"][0]["content"]["parts"][0]["text"] += suffix
        result = await self.query(payload)
        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["text"].endswith(suffix))
        self.assertEqual("".join(f["text"] for f in result["fragments"]), result["text"])

    async def test_multiple_parts_preserve_utf8_indices_and_optional_segment_text(self):
        payload = response_payload()
        candidate = payload["candidates"][0]
        first, second = "Önce 🌊.", " Sonra İlan."
        candidate["content"]["parts"] = [{"thought": True, "text": "Internal fixture"}, {"text": first}, {"text": second}]
        metadata = candidate["groundingMetadata"]
        metadata["groundingChunks"].insert(0, {"other": "not a web source"})
        metadata["groundingSupports"] = [
            {"segment": {"partIndex": 1, "endIndex": len(first.encode())}, "groundingChunkIndices": [1]},
            {"segment": {"partIndex": 2, "startIndex": 1, "endIndex": len(second.encode()), "text": second[1:]}, "groundingChunkIndices": [1]},
            {"segment": {"partIndex": 1, "startIndex": 1, "endIndex": 2}, "groundingChunkIndices": [1]},
            {"segment": {"partIndex": 2, "endIndex": len(second.encode()), "text": "mismatch"}, "groundingChunkIndices": [1]},
        ]
        result = await self.query(payload)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["text"], first + second)
        self.assertEqual(result["parts"][0], {})
        self.assertEqual(result["sources"][0]["index"], 1)
        self.assertEqual(result["fragments"], [{"text": first, "citation_indices": [1]}, {"text": second, "citation_indices": [1]}])

    async def test_invalid_utf8_supports_do_not_create_fake_citations(self):
        for segment in ({"startIndex": 4, "endIndex": 5}, {"endIndex": 99999}, {"endIndex": 6, "text": "wrong"}, {"startIndex": 0}, {"partIndex": 1, "endIndex": 6}):
            payload = response_payload()
            payload["candidates"][0]["groundingMetadata"]["groundingSupports"][0]["segment"] = segment
            result = await self.query(payload)
            self.assertEqual(result["status"], "no_grounding")
            self.assertTrue(all(not f["citation_indices"] for f in result["fragments"]))

    async def test_incomplete_or_non_json_provider_response_is_not_success(self):
        payload = response_payload()
        payload["candidates"][0]["finishReason"] = "MAX_TOKENS"
        result = await self.query(payload)
        self.assertEqual(result["status"], "provider_error")
        self.assertTrue(result["text"])
        result = await self.query(handler=lambda request: httpx.Response(200, text="Not JSON " + KEY))
        self.assertEqual(result["status"], "provider_error")
        self.assertNotIn(KEY, json.dumps(result))


if __name__ == "__main__":
    unittest.main()
