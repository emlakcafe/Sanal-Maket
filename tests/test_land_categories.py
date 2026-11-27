"""Land-only category regressions using the existing observed detail fixtures."""
import json
import unittest

import listing_readers
from test_readers import FIXTURES, REQUEST, fixture, parse


def set_field(soup, label, value, *, dom=True, structured=True):
    if dom:
        node = soup.find("dt", string=label) or soup.find("div", class_="property-detail-label", string=label)
        if node:
            (node.parent.find("dd") or node.parent.find("div", class_="property-detail-value")).string = value
    if structured:
        def mutate(node):
            if isinstance(node, list):
                for child in node:mutate(child)
            elif isinstance(node, dict):
                if node.get("@type") == "PropertyValue" and node.get("name") == label:
                    node["value"] = value
                for child in node.values():mutate(child)
        for script in soup.select('script[type="application/ld+json"]'):
            data = json.loads(script.string or script.get_text())
            mutate(data)
            script.string = json.dumps(data, ensure_ascii=False)


class LandCategoryTests(unittest.TestCase):
    def test_finished_villa_is_rejected_despite_area_parcel_and_zoning(self):
        soup = fixture("emlakjet-residential")
        set_field(soup, "Kategori", "Satılık Villa")
        # Existing floorSize, ada/parsel and the land-like marketing title remain.
        self.assertIsNone(parse("emlakjet-residential", soup))
        self.assertIn("konut/bina", listing_readers.detail_problem(str(soup), FIXTURES["emlakjet-residential"]["url"], "Emlakjet"))

    def test_building_categories_cannot_be_rescued_by_land_title(self):
        for category in ("Satılık Daire", "Satılık Konut", "Satılık 5+1 Villa", "Satılık Müstakil Ev", "Satılık Apartman Dairesi", "Satılık Ofis", "Satılık Arsa İçindeki Villa"):
            with self.subTest(category=category):
                soup = fixture("emlakjet-residential", structured=False)
                set_field(soup, "Kategori", category)
                self.assertIsNone(parse("emlakjet-residential", soup))

    def test_dom_or_json_building_category_blocks_conflicting_land_metadata(self):
        for dom, structured in ((True, False), (False, True)):
            with self.subTest(dom=dom, structured=structured):
                soup = fixture("emlakjet-residential")
                set_field(soup, "Kategori", "Satılık Villa", dom=dom, structured=structured)
                self.assertIsNone(parse("emlakjet-residential", soup))

    def test_explicit_land_categories_remain_supported(self):
        categories = (("Konut İmarlı / Satılık", "residential"), ("Villa İmarlı / Satılık", "residential"),
                      ("Satılık Arsa", "unknown"), ("Arsa/Arazi / Satılık", "unknown"),
                      ("Tarla / Satılık", "field"), ("Bağ & Bahçe / Satılık", "field"),
                      ("Satılık Sanayi İmarlı Arsa", "unknown"))
        for category, kind in categories:
            with self.subTest(category=category):
                soup = fixture("remax-500", structured=False)
                set_field(soup, "Emlak Tipi", category)
                row = parse("remax-500", soup)
                self.assertIsNotNone(row)
                self.assertEqual(row["kind"], kind)

    def test_remax_legacy_villa_category_requires_vacant_land_evidence(self):
        for state, accepted in (("Boş", True), ("Dolu", False), ("Bilinmiyor", False)):
            with self.subTest(state=state):
                soup = fixture("remax-500")
                set_field(soup, "Emlak Tipi", "Villa / Satılık")
                set_field(soup, "Arsa Durumu", state)
                row = parse("remax-500", soup)
                self.assertEqual(row is not None, accepted)
                if accepted:
                    self.assertEqual(row["kind"], "residential")
                    self.assertTrue(row["field_evidence"]["vacant_land"])

    def test_building_room_evidence_defeats_remax_legacy_exception(self):
        soup = fixture("remax-500")
        set_field(soup, "Emlak Tipi", "Villa / Satılık")
        row = soup.new_tag("div", attrs={"class": "property-detail-row"})
        label = soup.new_tag("div", attrs={"class": "property-detail-label"});label.string = "Oda Sayısı"
        value = soup.new_tag("div", attrs={"class": "property-detail-value"});value.string = "5+1"
        row.extend([label, value]);soup.select_one(".property-detail-section").append(row)
        self.assertIsNone(parse("remax-500", soup))

    def test_unknown_category_does_not_infer_land_from_title_or_parcel(self):
        for category in ("Satılık", "Satılık Emlak", "Kiralık Arsa"):
            with self.subTest(category=category):
                soup = fixture("emlakjet-residential", structured=False)
                set_field(soup, "Kategori", category)
                self.assertIsNone(parse("emlakjet-residential", soup))

    def test_search_card_cannot_turn_a_villa_into_a_priced_land_record(self):
        url = FIXTURES["emlakjet-residential"]["url"]
        listing = {"@type": "RealEstateListing", "url": url, "name": "Arsa içinde 5+1 villa",
                   "offers": {"price": 30000000, "priceCurrency": "TRY"},
                   "additionalProperty": [{"name": "Konum", "value": "Hacımehmet Köyü, Merkez"},
                                          {"name": "Metrekare", "value": "500"},
                                          {"name": "Kategori", "value": "Satılık Villa"}]}
        html = '<script type="application/ld+json">' + json.dumps(listing) + '</script>'
        result = listing_readers.candidates(html, "https://www.emlakjet.com/satilik-arsa/yalova-merkez", REQUEST, "Emlakjet")
        self.assertIn(url, result)
        self.assertIsNone(result[url])


if __name__ == "__main__":
    unittest.main()
