"""Source access protection must reduce requests, never bypass a refusal."""
import asyncio
import time
import unittest
from unittest.mock import patch

import httpx
import server


class SourceAccessTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.patches = [patch.dict(value, {}, clear=True) for value in
                        (server.cache, server.json_inflight, server.json_refusals)]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    async def test_identical_concurrent_requests_share_one_response(self):
        started, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def handler(request):
            calls.append(str(request.url))
            started.set()
            await release.wait()
            return httpx.Response(200, json={"features": [1]})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            owner = asyncio.create_task(server.getjson(client, "https://example.org/catalogue"))
            await started.wait()
            waiter = asyncio.create_task(server.getjson(client, "https://example.org/catalogue"))
            await asyncio.sleep(0)
            release.set()
            results = await asyncio.gather(owner, waiter)
            cached = await server.getjson(client, "https://example.org/catalogue")
        self.assertEqual(results, [{"features": [1]}] * 2)
        self.assertEqual(cached, results[0])
        self.assertEqual(len(calls), 1)
        self.assertFalse(server.json_inflight)

    async def test_refusal_is_not_retried_and_retry_after_is_respected(self):
        for status in (403, 429):
            calls = []
            url = "https://example.org/catalogue/" + str(status)

            def handler(request):
                calls.append(str(request.url))
                return httpx.Response(status, headers={"Retry-After": "600"})

            before = time.monotonic()
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                for _ in range(2):
                    with self.assertRaises(httpx.HTTPStatusError) as error:
                        await server.getjson(client, url)
                    self.assertEqual(error.exception.response.status_code, status)
            self.assertEqual(len(calls), 1)
            self.assertNotIn(url, server.cache)
            self.assertGreaterEqual(server.json_refusals[url][0], before + 600)

    async def test_cancelled_waiter_does_not_cancel_shared_fetch(self):
        started, release = asyncio.Event(), asyncio.Event()

        async def handler(request):
            started.set()
            await release.wait()
            return httpx.Response(200, json={"ok": True})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            owner = asyncio.create_task(server.getjson(client, "https://example.org/shared"))
            await started.wait()
            waiter = asyncio.create_task(server.getjson(client, "https://example.org/shared"))
            await asyncio.sleep(0)
            waiter.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await waiter
            release.set()
            self.assertEqual(await owner, {"ok": True})
        self.assertFalse(server.json_inflight)

    def test_parcel_refusal_is_distinguished_from_absent_parcel(self):
        request = httpx.Request("GET", "https://example.org/private-upstream-path")
        refusal = httpx.HTTPStatusError("RAW-ERROR-DETAILS", request=request,
                                       response=httpx.Response(403, request=request))
        state, message, code = server.tkgm_failure(refusal)
        self.assertEqual((state, code), ("blocked", 403))
        self.assertIn("erişim vermedi", message)
        self.assertNotIn("RAW-ERROR", message)
        self.assertNotIn("https://", message)
        missing = httpx.HTTPStatusError("404", request=request,
                                       response=httpx.Response(404, request=request))
        self.assertEqual(server.tkgm_failure(missing)[0], "error")

    async def test_owner_cancellation_is_a_source_error_not_other_job_cancellation(self):
        started = asyncio.Event()

        async def handler(request):
            started.set()
            await asyncio.Event().wait()

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            owner = asyncio.create_task(server.getjson(client, "https://example.org/cancelled-owner"))
            await started.wait()
            waiter = asyncio.create_task(server.getjson(client, "https://example.org/cancelled-owner"))
            await asyncio.sleep(0)
            owner.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await owner
            with self.assertRaises(httpx.RequestError):
                await waiter
        self.assertFalse(server.json_inflight)


if __name__ == "__main__":
    unittest.main()
