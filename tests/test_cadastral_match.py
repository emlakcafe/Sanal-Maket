import unittest
from copy import deepcopy

import cadastral_match as match


REQUEST = {"province": "Yalova", "district": "Merkez", "place": "Hacımehmet"}
SUBJECT = {"center": [40.644285, 29.25383]}
ITEM = {"title": "HACIMEHMET TOKİ LERİN ÜSTÜNDE ÖZEL KONUMLU SATILIK 500M2 PARSEL", "area": 500,
        "block": "181", "parcel": "15", "address": {"province": "Yalova", "district": "Merkez", "place": "Kazım Karabekir Mah."},
        "detail_verified": True, "live": True, "advertised_center": [40.63968430141065, 29.25137728328795]}
PARCEL = {"block": "181", "parcel": "15", "area": 500, "center": [40.63889, 29.25167]}


class CadastralEvidenceTests(unittest.TestCase):
    def test_observed_pin_and_official_parcel_agree_without_aliasing_address(self):
        row = deepcopy(ITEM)
        self.assertTrue(match.may_resolve(row, REQUEST, SUBJECT))
        evidence = match.agreement(row, PARCEL, "122362")
        self.assertEqual(evidence["resolution_method"], "title_parcel_pin_agreement")
        self.assertAlmostEqual(evidence["pin_delta_m"], 91.7, delta=1)
        self.assertEqual(row["address"]["place"], "Kazım Karabekir Mah.")

    def test_heading_nearby_mention_does_not_alias_locality(self):
        for title in ["Kazım Karabekir satılık arsa", "Hacımehmet'e yakın satılık arsa", "Hacımehmetcik satılık arsa", "Hacımehmet iki parsel satılık"]:
            self.assertFalse(match.may_resolve(dict(ITEM, title=title), REQUEST, SUBJECT), title)

    def test_missing_pin_wrong_district_dated_and_share_sales_rejected(self):
        variants = [{"advertised_center": None}, {"advertised_center": [40.7, 29.3]}, {"live": False}, {"share_sale": True},
                    {"address": {**ITEM["address"], "district": "Çiftlikköy"}}]
        for update in variants:
            self.assertFalse(match.may_resolve(dict(ITEM, **update), REQUEST, SUBJECT), update)

    def test_area_pin_and_identifiers_must_all_agree(self):
        for update in [{"area": 550}, {"center": [40.65, 29.25]}, {"parcel": "16"}, {"area": float("nan")}]:
            self.assertIsNone(match.agreement(ITEM, {**PARCEL, **update}, "122362"), update)


if __name__ == "__main__":
    unittest.main()
