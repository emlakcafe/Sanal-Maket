"""Offline tests for actual job execution, discovery ingestion and truthful state."""
import asyncio
from contextlib import ExitStack
from copy import deepcopy
import unittest
from unittest.mock import AsyncMock, patch

import httpx
import agent_runtime
import listing_search
import server


REQUEST = {"province": "Yalova", "district": "Merkez", "place": "Hacımehmet",
           "place_kind": "köy", "block": "1295", "parcel": "4", "zoning": "residential"}


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_states_follow_execution_and_unstarted_agents_are_not_completed(self):
        runtime = agent_runtime.AgentRuntime()
        self.addAsyncCleanup(runtime.shutdown)
        started, release = asyncio.Event(), asyncio.Event()

        async def runner(request, emit):
            emit("parcel", "running", "Fixture tool executing")
            started.set()
            await release.wait()
            emit("parcel", "complete", "Fixture tool finished", {"observations": 1})
            return {"subject": {"area": 500}, "items": []}

        job = runtime.start({}, runner)
        await started.wait()
        running = runtime.snapshot(job["job_id"])
        self.assertEqual(running["status"], "running")
        self.assertEqual(running["agent_count"], 6)
        self.assertEqual(running["active_agent_count"], 1)
        self.assertFalse(running["ai"]["running"])
        self.assertTrue(all(agent["engine"] == "rules_and_tools" for agent in running["agents"]))
        self.assertIsNone(running["result"])
        release.set()
        await runtime.tasks[job["job_id"]]
        done = runtime.snapshot(job["job_id"])
        self.assertEqual(done["status"], "partial")
        self.assertEqual(done["active_agent_count"], 0)
        self.assertEqual(done["completed_agent_count"], 1)
        self.assertEqual(sum(a["status"] == "blocked" for a in done["agents"]), 5)
        done["result"]["subject"]["area"] = 999
        self.assertEqual(runtime.snapshot(job["job_id"])["result"]["subject"]["area"], 500)

    async def test_concurrency_limit_rejects_extra_run_and_retention_is_bounded(self):
        runtime = agent_runtime.AgentRuntime(max_running=1, max_jobs=2)
        self.addAsyncCleanup(runtime.shutdown)
        release = asyncio.Event()

        async def held_runner(request, emit):
            emit("search", "running", "Fixture search")
            await release.wait()
            emit("search", "complete", "Fixture finished")
            return {"items": []}

        first = runtime.start({}, held_runner)
        with self.assertRaises(agent_runtime.RuntimeBusy):
            runtime.start({}, held_runner)
        release.set()
        await runtime.tasks[first["job_id"]]
        second = runtime.start({}, held_runner)
        await runtime.tasks[second["job_id"]]
        third = runtime.start({}, held_runner)
        await runtime.tasks[third["job_id"]]
        self.assertIsNone(runtime.snapshot(first["job_id"]))
        self.assertEqual(len(runtime.jobs), 2)

    async def test_timeout_and_failure_stop_active_state_without_leaking_errors(self):
        for timeout in (True, False):
            runtime = agent_runtime.AgentRuntime(timeout_seconds=.02)
            self.addAsyncCleanup(runtime.shutdown)

            async def runner(request, emit):
                emit("search", "running", "Fixture operation")
                if timeout:
                    await asyncio.Event().wait()
                raise RuntimeError("PRIVATE-PROVIDER-BODY")

            job = runtime.start({}, runner)
            await runtime.tasks[job["job_id"]]
            result = runtime.snapshot(job["job_id"])
            self.assertEqual(result["status"], "error")
            self.assertEqual(result["active_agent_count"], 0)
            self.assertIsNone(result["result"])
            self.assertNotIn("PRIVATE-PROVIDER-BODY", str(result))


class AgentEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_poll_capacity_and_unknown_id(self):
        runtime = agent_runtime.AgentRuntime(max_running=1)
        self.addAsyncCleanup(runtime.shutdown)
        started, release = asyncio.Event(), asyncio.Event()

        async def fixture_core(request, progress, enable_search=False):
            self.assertTrue(enable_search)
            progress("parcel", "running", "Fixture TKGM request")
            started.set()
            await release.wait()
            progress("parcel", "complete", "Fixture TKGM response")
            return {"subject": {"area": 500}, "items": []}

        with patch.object(server, "agent_jobs", runtime), patch.object(server, "analyze_core", fixture_core):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test") as client:
                response = await client.post("/api/agent-runs", json=REQUEST)
                self.assertEqual(response.status_code, 202)
                self.assertEqual(response.headers["cache-control"], "no-store")
                job_id = response.json()["job_id"]
                await started.wait()
                current = await client.get("/api/agent-runs/" + job_id)
                self.assertEqual(current.json()["active_agent_count"], 1)
                self.assertEqual((await client.post("/api/agent-runs", json=REQUEST)).status_code, 429)
                self.assertEqual((await client.get("/api/agent-runs/not-a-job")).status_code, 404)
                release.set()
                await runtime.tasks[job_id]
                complete = await client.get("/api/agent-runs/" + job_id)
                self.assertIsNotNone(complete.json()["result"])
                self.assertEqual(complete.json()["active_agent_count"], 0)

    async def test_search_discovery_enters_allowed_readers_but_not_valuation_directly(self):
        emlakjet_url = "https://www.emlakjet.com/ilan/fixture-111111"
        remax_url = "https://remax.com.tr/tr/portfoy/P12345678"
        blocked_url = "https://www.sahibinden.com/ilan/fixture-search-only-123456789/detay"
        candidates = [
            {"title": "Fixture listing", "url": url, "snippet": "Unverified search price 1 TL", "discovery_only": True,
             "location_verified": False, "detail_verified": False} for url in (emlakjet_url, remax_url, blocked_url)
        ]
        network = []

        def handler(request):
            network.append(str(request.url))
            self.assertIn(request.url.host, {"www.emlakjet.com", "remax.com.tr"})
            if request.url.path == "/robots.txt":
                return httpx.Response(200, text="User-agent: *\nAllow: /")
            return httpx.Response(200, text="<main><h1>Offline fixture</h1></main>")

        async def parcel(client, locality_id, block, number):
            area = 649.92 if block == "1295" else 3080 if block == "513" else 500
            return {"block": block, "parcel": number, "area": area, "nature": "Arsa",
                    "center": [40.644285 if block == "1295" else 40.646, 29.25383],
                    "geometry": {}, "source": "Offline TKGM fixture"}

        def detail(html, url, req, source):
            self.assertIn(url, {emlakjet_url, remax_url})
            large = source == "Emlakjet"
            return server.item_record("Offline detail fixture", url, 3080 if large else 500,
                                      165000000 if large else 7600000, "residential", "513" if large else "181",
                                      "7" if large else "15", source, True, detail_verified=True, share_sale=False,
                                      address={"province": "Yalova", "district": "Merkez", "place": "Hacımehmet"})

        async def search(req, subject=None, progress=None):
            if progress:
                progress({"status": "running", "message": "Fixture query executing", "counts": {"queries": 1}})
            await asyncio.sleep(0)
            return {"provider": "Exa", "status": "ok", "candidates": deepcopy(candidates), "queries": ["fixture"], "notes": []}

        with ExitStack() as stack:
            stack.enter_context(patch.dict(server.cache, {}, clear=True))
            stack.enter_context(patch.dict(server.research_contexts, {}, clear=True))
            stack.enter_context(patch.object(server, "gate", asyncio.Semaphore(2)))
            stack.enter_context(patch.object(server, "client", side_effect=lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))))
            stack.enter_context(patch.object(server, "locality", AsyncMock(return_value="12345")))
            stack.enter_context(patch.object(server, "parcel_data", parcel))
            stack.enter_context(patch.object(server, "parse_detail", detail))
            stack.enter_context(patch.object(server, "research_snapshot", return_value=[]))
            search_mock = stack.enter_context(patch.object(listing_search, "search", AsyncMock(side_effect=search)))
            runtime = agent_runtime.AgentRuntime()
            self.addAsyncCleanup(runtime.shutdown)
            job = runtime.start(server.Req(**REQUEST), lambda req, emit: server.analyze_core(req, emit, enable_search=True))
            await runtime.tasks[job["job_id"]]
            snapshot = runtime.snapshot(job["job_id"])
        self.assertEqual(snapshot["status"], "complete")
        self.assertEqual(snapshot["completed_agent_count"], 6)
        search_mock.assert_awaited_once()
        self.assertIn(emlakjet_url, network)
        self.assertIn(remax_url, network)
        self.assertNotIn(blocked_url, network)
        self.assertEqual(len(snapshot["search_candidates"]), 3)
        result = snapshot["result"]
        self.assertEqual(len(result["items"]), 2)
        self.assertEqual(result["nearby_count"], 2)
        self.assertEqual(result["comparable_count"], 1)
        self.assertIsNone(result["estimate"])
        large = next(item for item in result["items"] if item["area"] == 3080)
        self.assertEqual(large["price"], 165000000)
        self.assertFalse(large["valuation_eligible"])
        self.assertIn("325–1300", large["valuation_reason"])
        self.assertTrue(all(item["price"] != 1 for item in result["items"]))
        self.assertTrue(all(source["discovered_links"] == 1 for source in result["source_status"]))


if __name__ == "__main__":
    unittest.main()
