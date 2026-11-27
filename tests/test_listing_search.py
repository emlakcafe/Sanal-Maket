import json
import unittest
from unittest.mock import patch

import httpx
import listing_search as search


REQUEST = {"province": "Yalova", "district": "Merkez", "place": "Hacımehmet", "block": "1295", "parcel": "4"}


def result_text(title="Yalova Hacımehmet satılık 500 m² arsa", url="https://www.emlakjet.com/ilan/hacimehmet-500-19450696", text="7.600.000 TL\n500 m²\n15.200 TL/m²"):
    return {"content": [{"type": "text", "text": f"Title: {title}\nURL: {url}\nPublished: N/A\nAuthor: N/A\nHighlights:\n{text}\n"}]}


class DiscoveryParsingTests(unittest.TestCase):
    def test_search_index_is_not_live_or_located(self):
        rows, rejected = search.parse_candidates(result_text(), REQUEST, "test", "2026-11-27T10:00:00Z")
        self.assertEqual(rejected, 0)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["asking_price"], 7_600_000)
        self.assertEqual(row["area"], 500)
        self.assertEqual(row["checked_at"], "2026-11-27T10:00:00Z")
        self.assertFalse(row["location_verified"])
        self.assertFalse(row["detail_verified"])
        self.assertIsNone(row["distance_m"])
        self.assertNotIn("listing_date", row)

    def test_wrong_place_and_same_named_village_rejected(self):
        rows, rejected = search.parse_candidates(result_text(title="Çanakkale Ezine Akköy satılık arsa", text="3.200.000 TL 400 m²", url="https://www.emlakjet.com/ilan/canakkale-akkoy-123"), {"province": "Yalova", "district": "Termal", "place": "Akköy"}, "query")
        self.assertEqual((len(rows), rejected), (0, 1))
        rows, rejected = search.parse_candidates(result_text(title="Yalova Merkez Safran satılık arsa", url="https://www.emlakjet.com/ilan/safran-19991978"), REQUEST, "Hacımehmet query is not evidence")
        self.assertEqual((len(rows), rejected), (0, 1))

    def test_individual_blocks_do_not_mix_prices(self):
        first = result_text()["content"][0]["text"]
        second = result_text("Yalova Hacımehmet 565 m² arsa", "https://www.cb.com.tr/yalova-merkez-hacimehmet-satilik/konut-imarli/363873", "6.600.000 TL\n565 m²")["content"][0]["text"]
        rows, _ = search.parse_candidates({"content": [{"type": "text", "text": first + "\n---\n\n" + second}]}, REQUEST, "query")
        self.assertEqual([(r["asking_price"], r["area"]) for r in rows], [(7_600_000, 500), (6_600_000, 565)])

    def test_category_does_not_acquire_single_listing_price(self):
        rows, _ = search.parse_candidates(result_text(url="https://www.sahibinden.com/satilik-arsa/yalova-merkez-hacimehmet-koyu"), REQUEST, "query")
        self.assertEqual(rows[0]["candidate_type"], "category")
        self.assertIsNone(rows[0]["asking_price"])
        self.assertIsNone(rows[0]["area"])

    def test_numbers_reject_conflicting_prices_and_areas(self):
        self.assertEqual(search.excerpt_numbers("11,500,000 TL 1.463 m² 11.500.000 TL"), {"asking_price": 11_500_000, "area": 1463})
        self.assertIsNone(search.excerpt_numbers("3.200.000 TL 3.800.000 TL 400 m²")["asking_price"])
        self.assertIsNone(search.excerpt_numbers("432 m² + 392 m² toplam 824 m²")["area"])
        self.assertEqual(search.excerpt_numbers("400 m² 8.000 TL/m² 3.200.000 TL")["asking_price"], 3_200_000)

    def test_land_area_label_beats_construction_area(self):
        text = "Yalova Akköy satılık arsa\n4.000.000 TL\nm²\n582\n\n## Açıklama\n180M2 Brüt inşaat alanı"
        self.assertEqual(search.excerpt_numbers(text)["area"], 582)

    def test_completed_villa_is_not_land_search_candidate(self):
        data = result_text("Yalova Hacımehmet Satılık 5+1 Villa", "https://www.emlakjet.com/ilan/hacimehmet-villa-19196227", "12.450.000 TL\n400 m²\nKategori\nSatılık Villa\n360 m² net")
        self.assertEqual(search.parse_candidates(data, REQUEST, "satılık arsa")[0], [])

    def test_incidental_locality_mentions_do_not_change_address(self):
        data = result_text("Yalova Safran satılık arsa, Hacımehmet köyüne yakın", "https://www.emlakjet.com/ilan/safran-123456", "7.600.000 TL 500 m²")
        self.assertEqual(search.parse_candidates(data, REQUEST, "query")[0], [])
        data = result_text("Çanakkale Ayvacık Akköy satılık arsa", "https://www.emlakjet.com/ilan/canakkale-akkoy-123456", "3.200.000 TL 400 m²\nYalova Termal yatırımları gibi")
        self.assertEqual(search.parse_candidates(data, {"province": "Yalova", "district": "Termal", "place": "Akköy"}, "query")[0], [])

    def test_explicit_address_can_supply_missing_province_in_heading(self):
        data = result_text("Hacımehmet TOKİ üstünde 500 m² parsel", "https://remax.com.tr/tr/portfoy/P57632473", "7.600.000 TL\n500 m²\nYalova / Merkez / Kazım Karabekir Mah.")
        self.assertEqual(len(search.parse_candidates(data, REQUEST, "query")[0]), 1)

    def test_urls_are_safe_and_source_names_not_spoofed(self):
        for url in ["javascript:alert(1)", "http://example.com/", "https://127.0.0.1/", "https://169.254.169.254/", "https://user:pass@example.com/", "https://example.com:8443/", "https://host.local/path"]:
            self.assertIsNone(search.safe_url(url), url)
        self.assertEqual(search.source_name("https://emlakjet.com.evil.example/ilan/1"), "emlakjet.com.evil.example")

    def test_rpc_matches_id_and_multiline_sse(self):
        body = 'event: message\ndata: {"jsonrpc":"2.0","id":3,\ndata: "result":{"ok":true}}\n\n'
        self.assertEqual(search._decode_rpc(body, 3)["result"], {"ok": True})
        with self.assertRaises(ValueError):
            search._decode_rpc('{"id":99,"result":{}}', 3)


class DiscoveryNetworkTests(unittest.IsolatedAsyncioTestCase):
    def make_transport(self, fail_at=None):
        calls = []

        async def handler(request):
            self.assertEqual(str(request.url), search.MCP_ENDPOINT)
            payload = json.loads(request.content)
            calls.append(payload)
            method = payload["method"]
            if method == "initialize":
                value = {"protocolVersion": "2024-11-05", "capabilities": {}, "serverInfo": {"name": "test"}}
            elif method == "notifications/initialized":
                return httpx.Response(202)
            else:
                self.assertEqual(method, "tools/call")
                self.assertEqual(payload["params"]["name"], "web_search_exa")
                self.assertEqual(set(payload["params"]["arguments"]), {"query", "objective", "numResults"})
                if fail_at == payload["id"]:
                    return httpx.Response(429)
                value = result_text()
            return httpx.Response(200, text="event: message\ndata: " + json.dumps({"id": payload["id"], "jsonrpc": "2.0", "result": value}) + "\n\n", headers={"Content-Type": "text/event-stream"})

        return httpx.MockTransport(handler), calls

    async def test_real_tool_plan_no_source_fetch_and_dedup(self):
        transport, calls = self.make_transport()
        progress = []
        result = await search.search(REQUEST, transport=transport, progress=progress.append)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["matched_count"], 1)
        self.assertEqual(len(result["queries"]), 3)
        self.assertEqual(len(result["candidates"][0]["queries"]), 3)
        self.assertEqual(result["source_fetches"], 0)
        self.assertEqual(len(calls), 5)
        self.assertEqual(progress[-1]["status"], "complete")

    async def test_limit_stops_without_retry_or_new_identity(self):
        transport, calls = self.make_transport(fail_at=10)
        result = await search.search(REQUEST, transport=transport)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["candidates"], [])
        self.assertEqual(len(calls), 3)

    async def test_completed_results_survive_later_limit(self):
        transport, calls = self.make_transport(fail_at=11)
        result = await search.search(REQUEST, transport=transport)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(len(result["candidates"]), 1)
        self.assertEqual(len(calls), 4)


if __name__ == "__main__":
    unittest.main()
