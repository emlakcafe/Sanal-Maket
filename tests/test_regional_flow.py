"""The exact reported failure must still yield an honest regional summary."""
import asyncio
from contextlib import ExitStack
from datetime import datetime, timezone
import unittest
from unittest.mock import AsyncMock, patch

import httpx
import agent_runtime
import listing_search
import server


class RegionalFlowTests(unittest.IsolatedAsyncioTestCase):
    async def test_tkgm_refusal_does_not_suppress_regional_prices_or_fake_distance(self):
        req = server.Req(province="Yalova", district="Termal", place="Akköy",
                         place_kind="köy", block="354", parcel="12", zoning="unknown")
        upstream_request = httpx.Request("GET", "https://example.org/fixture-locality")
        refusal = httpx.HTTPStatusError("PRIVATE-FIXTURE-ERROR", request=upstream_request,
                                       response=httpx.Response(403, request=upstream_request))

        async def readers(client, request, source, progress=None, output=None, **kwargs):
            rows = output if output is not None else []
            if source == "Emlakjet":
                for index, (area, price) in enumerate(((400, 3200000), (500, 4500000), (600, 6000000)), 1):
                    rows.append(server.item_record(
                        f"Yalova Termal Akköy satılık konut imarlı arsa {index}",
                        f"https://www.emlakjet.com/ilan/fixture-2000000{index}", area, price,
                        "residential", str(400 + index), "1", source, True,
                        detail_verified=True, share_sale=False,
                        checked_at=datetime.now(timezone.utc).isoformat(),
                        field_evidence={"category": "Satılık Konut İmarlı", "ownership": "Müstakil Tapulu"},
                        address={"province": "Yalova", "district": "Termal", "place": "Akköy Köyü"}))
            if progress is not None:
                progress.update(status="ok", details_read=len(rows))
            return rows, progress

        with ExitStack() as stack:
            stack.enter_context(patch.object(server, "gate", asyncio.Semaphore(2)))
            locality = stack.enter_context(patch.object(server, "locality", AsyncMock(side_effect=refusal)))
            parcel = stack.enter_context(patch.object(server, "parcel_data", AsyncMock()))
            stack.enter_context(patch.object(server, "search_source", readers))
            stack.enter_context(patch.object(server, "research_snapshot", return_value=[]))
            stack.enter_context(patch.object(listing_search, "search", AsyncMock(return_value={
                "provider": "Exa", "status": "empty", "candidates": [], "queries": ["fixture"], "notes": []})))
            runtime = agent_runtime.AgentRuntime()
            self.addAsyncCleanup(runtime.shutdown)
            job = runtime.start(req, lambda request, emit: server.analyze_core(request, emit, enable_search=True))
            await runtime.tasks[job["job_id"]]
            snapshot = runtime.snapshot(job["job_id"])
        result = snapshot["result"]
        locality.assert_awaited_once()
        parcel.assert_not_awaited()
        self.assertEqual(snapshot["status"], "partial")
        self.assertIsNone(result["subject"])
        self.assertIsNone(result["estimate"])
        self.assertEqual(result["nearby_count"], 0)
        self.assertEqual(result["comparable_count"], 0)
        self.assertTrue(all(row["distance"] is None for row in result["items"]))
        group = next(row for row in result["regional_analysis"]["groups"] if row["kind"] == "residential")
        self.assertEqual(group["count"], 3)
        self.assertEqual(group["unit_q25"], 8500)
        self.assertEqual(group["unit_q75"], 9500)
        self.assertIsNone(group["total_low"])
        self.assertIsNone(group["total_high"])
        states = {row["id"]: row for row in snapshot["agents"]}
        self.assertEqual(states["parcel"]["status"], "blocked")
        self.assertEqual(states["location"]["status"], "blocked")
        self.assertEqual(states["valuation"]["status"], "complete")
        self.assertIn("Bölgesel", states["valuation"]["message"])
        self.assertNotIn("PRIVATE-FIXTURE-ERROR", str(result))
        self.assertTrue(any("HTTP 403" in warning for warning in result["warnings"]))


if __name__ == "__main__":
    unittest.main()
