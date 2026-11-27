"""Regional prices remain useful without TKGM and keep source evidence honest."""
from copy import deepcopy
import json
import unittest

from regional_analysis import build_regional_analysis


REQUEST = {"province":"Yalova","district":"Termal","place":"Akköy",
           "block":"354","parcel":"12","zoning":"unknown"}


def detail(number, area=400, price=3600000, **kwargs):
    row={"title":"Yalova Termal Akköy satılık konut imarlı arsa",
         "url":f"https://www.emlakjet.com/ilan/arsa-{20000000+number}",
         "source":"Emlakjet","area":area,"price":price,"kind":"residential",
         "address":{"province":"Yalova","district":"Termal","place":"Akköy Köyü"},
         "live":True,"detail_verified":True,"checked_at":"2026-11-27T12:00:00Z",
         "field_evidence":{"category":"Satılık Konut İmarlı","zoning":"Konut İmarlı"}}
    row.update(kwargs)
    return row


def indexed(number, snippet="400 m² 3.600.000 TL", **kwargs):
    row={"title":"Yalova Termal Akköy satılık konut imarlı arsa",
         "url":f"https://www.emlakjet.com/ilan/arsa-{21000000+number}",
         "snippet":snippet,"source":"Emlakjet","candidate_type":"listing",
         "evidence_status":"search_index","asking_price":None,"area":None,
         "checked_at":"2026-11-27T12:00:00Z"}
    row.update(kwargs)
    return row


def residential(result):
    return next(group for group in result["groups"] if group["kind"]=="residential")


class RegionalAnalysisTests(unittest.TestCase):
    def test_tkgm_absent_still_produces_source_backed_unit_band_without_target_total(self):
        rows=[detail(1,400,3200000,distance=5000),detail(2,500,4500000),detail(3,600,6000000)]
        before=deepcopy(rows)
        result=build_regional_analysis(REQUEST,None,rows,[])
        group=residential(result)
        self.assertEqual(result["status"],"available")
        self.assertEqual((group["unit_q25"],group["unit_median"],group["unit_q75"]),(8500,9000,9500))
        self.assertEqual((group["unit_min"],group["unit_max"]),(8000,10000))
        self.assertEqual((group["count"],group["detail_count"],group["index_count"]),(3,3,0))
        self.assertIsNone(group["total_low"])
        self.assertIsNone(result["subject_area"])
        self.assertTrue(all(row["distance_scope"]=="regional" and not row["location_verified"] for row in group["records"]))
        self.assertEqual(rows,before)

    def test_three_unique_records_required_and_observed_extremes_are_not_filled_early(self):
        result=build_regional_analysis(REQUEST,None,[detail(1),detail(2)],[])
        self.assertEqual(result["status"],"insufficient")
        self.assertIsNone(residential(result)["unit_q25"])
        self.assertIsNone(residential(result)["unit_min"])

    def test_subject_area_requires_tkgm_and_similar_sizes_for_conditional_totals(self):
        rows=[detail(1,400,3200000),detail(2,400,3600000),detail(3,400,4000000),
              detail(4,2000,4000000,kind="field",title="Satılık tarla",field_evidence={"category":"Satılık Tarla"})]
        unverified=build_regional_analysis(REQUEST,{"source":"Search","area":400},rows,[])
        self.assertIsNone(residential(unverified)["total_low"])
        result=build_regional_analysis(REQUEST,{"source":"TKGM","area":400},rows,[])
        group=residential(result)
        self.assertEqual((group["total_low"],group["total_high"]),(3400000,3800000))
        self.assertTrue(group["conditional_zoning"])
        self.assertEqual(result["excluded_counts"]["size_mismatch"],1)
        field=next(group for group in result["groups"] if group["kind"]=="field")
        self.assertEqual(field["count"],0)
        self.assertIsNone(field["total_low"])

    def test_generic_arsa_is_not_residential_and_field_has_its_own_group(self):
        rows=[detail(1,title="Satılık arsa",kind="unknown",field_evidence={}),
              detail(2,1000,2000000,kind="field",title="Satılık tarla",field_evidence={"category":"Satılık Tarla"})]
        result=build_regional_analysis(REQUEST,None,rows,[])
        self.assertEqual(residential(result)["count"],0)
        self.assertEqual(next(g for g in result["groups"] if g["kind"]=="field")["count"],1)
        self.assertEqual(result["excluded_counts"]["unknown_kind"],1)

    def test_index_price_after_unit_is_not_used_as_land_area(self):
        result=build_regional_analysis(REQUEST,None,[],[indexed(1,"500 m² 4.000.000 TL")])
        row=residential(result)["records"][0]
        self.assertEqual((row["area"],row["asking_price"],row["unit_price"]),(500,4000000,8000))
        self.assertEqual(row["evidence"],"search_index")
        self.assertFalse(row["location_verified"])

    def test_unit_price_after_malformed_metrekare_label_is_not_an_area(self):
        result=build_regional_analysis(REQUEST,None,[],[indexed(1,"4.200.000 TL 446 m² Metrekare 9417 TL/m²")])
        self.assertEqual(residential(result)["records"][0]["area"],446)

    def test_land_label_wins_over_later_construction_capacity_but_two_prices_conflict(self):
        snippet="Yalova / Termal / Akköy 3.000.000 TL m² 582 180 M2 Brüt inşaat alanı"
        result=build_regional_analysis(REQUEST,None,[],[indexed(1,snippet)])
        self.assertEqual(residential(result)["records"][0]["area"],582)
        result=build_regional_analysis(REQUEST,None,[],[indexed(1,snippet+" 3.750.000 TL")])
        self.assertEqual(residential(result)["count"],0)
        self.assertEqual(result["excluded_counts"]["conflicting_values"],1)

    def test_cadastral_labels_are_not_interpreted_as_count_of_parcels(self):
        snippet="3.550.000 TL Metrekare 480 m² Ada 465 Parsel 9 İmar Durumu Konut İmarlı"
        result=build_regional_analysis(REQUEST,None,[],[indexed(1,snippet)])
        row=residential(result)["records"][0]
        self.assertEqual((row["block"],row["parcel"]),("465","9"))
        result=build_regional_analysis(REQUEST,None,[],[indexed(1,snippet,title="Yalova Termal Akköy 465 ada 9 parsel konut imarlı arsa")])
        self.assertEqual(residential(result)["count"],1)
        result=build_regional_analysis(REQUEST,None,[],[indexed(2,snippet+" İki adet parsel birlikte satılık")])
        self.assertEqual(result["excluded_counts"]["multiple_parcels"],1)

    def test_index_must_prove_own_region_not_scattered_or_nearby_mentions(self):
        request={**REQUEST,"district":"Merkez","place":"Hacımehmet"}
        rows=[indexed(1,"500m² 4.000.000 TL Yalova Merkez Safran köyünde. Hacımehmet köyüne yakın.",
                      title="Yalova Merkez Safran Satılık Konut İmarlı Arsa"),
              indexed(2,"500m² 4.000.000 TL Yalova Merkez Hacımehmet fiyatlarıyla karşılaştırılabilir.",
                      title="Çanakkale Ayvacık Hacımehmet Satılık Konut İmarlı Arsa")]
        result=build_regional_analysis(request,None,[],rows)
        self.assertEqual(residential(result)["count"],0)
        self.assertEqual(result["excluded_counts"]["region_unconfirmed"],2)

    def test_own_source_address_overrides_matching_query_title(self):
        row=indexed(1,address={"province":"Yalova","district":"Termal","place":"Yenimahalle"})
        result=build_regional_analysis(REQUEST,None,[],[row])
        self.assertEqual(result["excluded_counts"]["region_mismatch"],1)
        for address in ("Yenimahalle Köyü, Termal, Yalova.","Yalova / Termal / Yenimahalle Köyü."):
            with self.subTest(address=address):
                result=build_regional_analysis(REQUEST,None,[],[indexed(2,address+" 4.000.000 TL 500m²")])
                self.assertEqual(result["excluded_counts"]["region_mismatch"],1)

    def test_numeric_title_multiple_parcels_is_rejected(self):
        row=detail(1,price=8000000,title="Yalova Termal Akköy satılık 2 parsel konut imarlı arsa")
        result=build_regional_analysis(REQUEST,None,[row],[])
        self.assertEqual(result["excluded_counts"]["multiple_parcels"],1)

    def test_widget_related_listing_and_construction_only_values_never_create_prices(self):
        snippets=["500 m². EmlakZeka Ortalama bölge değeri:4.000.000 TL",
                  "500 m². Benzer İlanlar Yalova Termal Akköy satılık arsa 4.000.000 TL",
                  "4.000.000 TL. 180m² inşaat hakkı, arsa alanı belirtilmemiş"]
        result=build_regional_analysis(REQUEST,None,[],[indexed(n,s) for n,s in enumerate(snippets)])
        self.assertEqual(residential(result)["count"],0)
        self.assertEqual(result["excluded_counts"]["missing_values"],3)

    def test_subject_itself_excluded_without_tkgm(self):
        result=build_regional_analysis(REQUEST,None,[detail(1,block="354",parcel="12")],[])
        self.assertEqual(result["excluded_counts"]["subject_listing"],1)

    def test_current_detail_supersedes_all_its_url_aliases_even_when_rejected(self):
        candidate=indexed(1)
        row=detail(1,share_sale=True,source_urls=[candidate["url"]])
        result=build_regional_analysis(REQUEST,None,[row],[candidate])
        self.assertEqual(residential(result)["count"],0)
        self.assertEqual(result["excluded_counts"],{"share_sale":1,"superseded_by_detail":1})

    def test_cadastral_duplicate_normalizes_locality_suffix_and_conflicts_exclude_property(self):
        a=detail(1,block="181",parcel="15",locality_id="166845")
        b=detail(2,block="181",parcel="15",address={"province":"Yalova","district":"Termal","place":"Akköy"})
        result=build_regional_analysis(REQUEST,None,[a,b],[])
        self.assertEqual(residential(result)["count"],1)
        self.assertEqual(set(residential(result)["records"][0]["source_urls"]),{a["url"],b["url"]})
        b["price"]=4000000
        result=build_regional_analysis(REQUEST,None,[a,b],[])
        self.assertEqual(residential(result)["count"],0)
        self.assertEqual(result["excluded_counts"]["conflicting_observations"],2)

    def test_zero_cadastral_values_do_not_merge_unrelated_listings(self):
        result=build_regional_analysis(REQUEST,None,[detail(n,block="0",parcel="0") for n in (1,2,3)],[])
        self.assertEqual(residential(result)["count"],3)

    def test_invalid_category_shared_building_dated_and_known_area_conflicts_are_excluded(self):
        rows=[detail(1,share_sale=True),detail(2,reader="dated-source-observation",observed_on="2026-11-26"),
              detail(3,title="Yatırımlık",field_evidence={"category":"Satılık Daire"}),
              detail(4,field_evidence={"category":"Satılık Konut İmarlı","zoning":"Tarla"}),
              detail(5,location_note="İlan alanı TKGM parsel alanıyla uyuşmadı"),
              detail(6,title="400m² arsa üzerinde tamamlanmış villa"),
              detail(7,title="Müstakil satılık villa arsası")]
        result=build_regional_analysis(REQUEST,None,rows,[])
        self.assertEqual(residential(result)["count"],1)
        self.assertEqual(residential(result)["records"][0]["url"],rows[-1]["url"])
        self.assertEqual(result["excluded_counts"],{"share_sale":1,"dated_snapshot":1,"building":2,"unknown_kind":1,"parcel_area_conflict":1})

    def test_invalid_nonfinite_or_unsafe_inputs_never_break_json_serialization(self):
        rows=[detail(1,price=float("inf")),detail(2,area=float("nan")),detail(3,area=5e-324,price=1e308),
              detail(4,url="javascript:alert(1)"),detail(5,url="https://127.0.0.1/ilan/a-20000005")]
        result=build_regional_analysis(REQUEST,None,rows,[])
        self.assertEqual(residential(result)["count"],0)
        json.dumps(result,allow_nan=False)


if __name__=="__main__":unittest.main()
