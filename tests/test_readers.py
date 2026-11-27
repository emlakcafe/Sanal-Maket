"""Regression cases derived from source HTML observed on 2026-11-27.

Fixtures retain only canonical URLs, listing fields, source DOM, and JSON-LD.
Marketing descriptions, images, adviser names, contacts, and scripts are removed.
The fixtures test extraction; they are never live research or valuation data.
Run from repository root: python -m unittest discover -s tests -v
"""
import unittest
from types import SimpleNamespace

from bs4 import BeautifulSoup
import listing_readers


FIXTURES = {'remax-500': {'url': 'https://remax.com.tr/tr/portfoy/P57632473', 'html': '<!DOCTYPE html>\n<html><head><link href="https://remax.com.tr/tr/portfoy/P57632473" rel="canonical"/><script type="application/ld+json">[{"@context": "https://schema.org", "@type": "RealEstateListing", "url": "https://remax.com.tr/tr/portfoy/P57632473", "name": "HACIMEHMET TOKİ LERİN ÜSTÜNDE ÖZEL KONUMLU SATILIK 500M2 PARSEL", "address": {"@type": "PostalAddress", "addressCountry": "TR", "addressRegion": "Yalova", "addressLocality": "Kazım Karabekir Mah."}, "offers": {"@type": "Offer", "price": 7600000, "priceCurrency": "TRY", "availability": "https://schema.org/InStock", "url": "https://remax.com.tr/tr/portfoy/P57632473"}}, {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Ana Sayfa", "item": "https://remax.com.tr/tr"}, {"@type": "ListItem", "position": 2, "name": "Arsa/Arazi", "item": "https://remax.com.tr/tr/arsa-arazi"}, {"@type": "ListItem", "position": 3, "name": "Satılık", "item": "https://remax.com.tr/tr/arsa-arazi/satilik"}, {"@type": "ListItem", "position": 4, "name": "Yalova", "item": "https://remax.com.tr/tr/arsa-arazi/satilik/yalova"}, {"@type": "ListItem", "position": 5, "name": "Merkez", "item": "https://remax.com.tr/tr/arsa-arazi/satilik/yalova/merkez"}, {"@type": "ListItem", "position": 6, "name": "HACIMEHMET TOKİ LERİN ÜSTÜNDE ÖZEL KONUMLU SATILIK 500M2 PARSEL", "item": "https://remax.com.tr/tr/portfoy/P57632473"}]}]</script></head><body><main><h1 class="property__detail-header-title-text flex-1">HACIMEHMET TOKİ LERİN ÜSTÜNDE ÖZEL KONUMLU SATILIK 500M2 PARSEL</h1><div class="flex flex-wrap items-center gap-2"><div class="flex items-end gap-2"><h2 class="mb-0 text-xl font-bold text-[#003DA5]">7.600.000<!-- --> <!-- -->₺</h2></div></div><div class="mb-3 flex-wrap items-center gap-0.5 flex"><a class="flex items-center gap-1 text-[10px] text-[#9C9C9C] hover:no-underline hover:text-[#003DA5]" href="/tr"></a><a class="text-[10px] text-[#9C9C9C] hover:no-underline hover:text-[#003DA5] capitalize" href="/tr/arsa-arazi/satilik/yalova?sort=13%2Cdesc&amp;currencyId=1">Yalova</a><span class="flex items-center gap-1 text-[10px] text-[#9C9C9C]"></span><a class="text-[10px] text-[#9C9C9C] hover:no-underline hover:text-[#003DA5] capitalize" href="/tr/arsa-arazi/satilik/yalova/merkez?sort=13%2Cdesc&amp;currencyId=1">Merkez</a><span class="flex items-center gap-1 text-[10px] text-[#9C9C9C]"></span><a class="text-[10px] text-[#9C9C9C] hover:no-underline hover:text-[#003DA5] capitalize" href="/tr/arsa-arazi/satilik/yalova/merkez/kazim-karabekir-mah?sort=13%2Cdesc&amp;currencyId=1">Kazım Karabekir Mah.</a></div><div class="property-detail-section"><div class="property-detail-row"><div class="property-detail-label">Portföy No</div><div class="property-detail-value">P57632473</div></div><div class="property-detail-row"><div class="property-detail-label">Emlak Tipi</div><div class="property-detail-value">Konut İmarlı / Satılık</div></div><div class="property-detail-row"><div class="property-detail-label">Yayınlanma Tarihi</div><div class="property-detail-value">19.06.2026</div></div><div class="property-detail-row"><div class="property-detail-label">m²</div><div class="property-detail-value">500</div></div><div class="property-detail-row"><div class="property-detail-label">Krediye Uygun</div><div class="property-detail-value">Evet</div></div><div class="property-detail-row"><div class="property-detail-label">Arsa Durumu</div><div class="property-detail-value">Boş</div></div><div class="property-detail-row"><div class="property-detail-label">Emsal (Kaks)</div><div class="property-detail-value">0.60</div></div><div class="property-detail-row"><div class="property-detail-label">Gabari</div><div class="property-detail-value">6.50</div></div><div class="property-detail-row"><div class="property-detail-label">Tapu Durumu</div><div class="property-detail-value">Müstakil Parsel</div></div><div class="property-detail-row"><div class="property-detail-label">Parsel</div><div class="property-detail-value">15</div></div><div class="property-detail-row"><div class="property-detail-label">Ada</div><div class="property-detail-value">181</div></div></div></main></body></html>', 'expected': (7600000, 500, 'residential', '181', '15', 'Kazım Karabekir')}, 'remax-field': {'url': 'https://remax.com.tr/tr/portfoy/P43850183', 'html': '<!DOCTYPE html>\n<html><head><link href="https://remax.com.tr/tr/portfoy/P43850183" rel="canonical"/><script type="application/ld+json">[{"@context": "https://schema.org", "@type": "RealEstateListing", "url": "https://remax.com.tr/tr/portfoy/P43850183", "name": "YALOVA MERKEZ HACIMEHMET\'TE ASFALT YOLA CEPHE ÖZEL KONUMLU TARLA", "address": {"@type": "PostalAddress", "addressCountry": "TR", "addressRegion": "Yalova", "addressLocality": "Hacımehmet Köyü (Merkez Mah.)"}, "offers": {"@type": "Offer", "price": 16500000, "priceCurrency": "TRY", "availability": "https://schema.org/InStock", "url": "https://remax.com.tr/tr/portfoy/P43850183"}}, {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Ana Sayfa", "item": "https://remax.com.tr/tr"}, {"@type": "ListItem", "position": 2, "name": "Arsa/Arazi", "item": "https://remax.com.tr/tr/arsa-arazi"}, {"@type": "ListItem", "position": 3, "name": "Satılık", "item": "https://remax.com.tr/tr/arsa-arazi/satilik"}, {"@type": "ListItem", "position": 4, "name": "Yalova", "item": "https://remax.com.tr/tr/arsa-arazi/satilik/yalova"}, {"@type": "ListItem", "position": 5, "name": "Merkez", "item": "https://remax.com.tr/tr/arsa-arazi/satilik/yalova/merkez"}, {"@type": "ListItem", "position": 6, "name": "YALOVA MERKEZ HACIMEHMET\'TE ASFALT YOLA CEPHE ÖZEL KONUMLU TARLA", "item": "https://remax.com.tr/tr/portfoy/P43850183"}]}]</script></head><body><main><h1 class="property__detail-header-title-text flex-1">YALOVA MERKEZ HACIMEHMET\'TE ASFALT YOLA CEPHE ÖZEL KONUMLU TARLA</h1><div class="flex flex-wrap items-center gap-2"><div class="flex items-end gap-2"><h2 class="mb-0 text-xl font-bold text-[#003DA5]">16.500.000<!-- --> <!-- -->₺</h2></div></div><div class="mb-3 flex-wrap items-center gap-0.5 flex"><a class="flex items-center gap-1 text-[10px] text-[#9C9C9C] hover:no-underline hover:text-[#003DA5]" href="/tr"></a><a class="text-[10px] text-[#9C9C9C] hover:no-underline hover:text-[#003DA5] capitalize" href="/tr/arsa-arazi/satilik/yalova?sort=13%2Cdesc&amp;currencyId=1">Yalova</a><span class="flex items-center gap-1 text-[10px] text-[#9C9C9C]"></span><a class="text-[10px] text-[#9C9C9C] hover:no-underline hover:text-[#003DA5] capitalize" href="/tr/arsa-arazi/satilik/yalova/merkez?sort=13%2Cdesc&amp;currencyId=1">Merkez</a><span class="flex items-center gap-1 text-[10px] text-[#9C9C9C]"></span><a class="text-[10px] text-[#9C9C9C] hover:no-underline hover:text-[#003DA5] capitalize" href="/tr/arsa-arazi/satilik/yalova/merkez/hacimehmet-koyu--merkez-mah?sort=13%2Cdesc&amp;currencyId=1">Hacımehmet Köyü (Merkez Mah.)</a></div><div class="property-detail-section"><div class="property-detail-row"><div class="property-detail-label">Portföy No</div><div class="property-detail-value">P43850183</div></div><div class="property-detail-row"><div class="property-detail-label">Emlak Tipi</div><div class="property-detail-value">Bağ &amp; Bahçe / Satılık</div></div><div class="property-detail-row"><div class="property-detail-label">Yayınlanma Tarihi</div><div class="property-detail-value">12.06.2025</div></div><div class="property-detail-row"><div class="property-detail-label">m²</div><div class="property-detail-value">5.537</div></div><div class="property-detail-row"><div class="property-detail-label">Krediye Uygun</div><div class="property-detail-value">Hayır</div></div><div class="property-detail-row"><div class="property-detail-label">Arsa Durumu</div><div class="property-detail-value">Boş</div></div><div class="property-detail-row"><div class="property-detail-label">Emsal (Kaks)</div><div class="property-detail-value">0</div></div><div class="property-detail-row"><div class="property-detail-label">Tapu Durumu</div><div class="property-detail-value">Müstakil Parsel</div></div><div class="property-detail-row"><div class="property-detail-label">Parsel</div><div class="property-detail-value">25</div></div><div class="property-detail-row"><div class="property-detail-label">Ada</div><div class="property-detail-value">131</div></div></div></main></body></html>', 'expected': (16500000, 5537, 'field', '131', '25', 'Hacımehmet')}, 'emlakjet-residential': {'url': 'https://www.emlakjet.com/ilan/yalova-merkez-de-satilik-3-080-m-40-konut-imarli-arsa-19674488', 'html': '<!DOCTYPE html>\n<html><head><link href="https://www.emlakjet.com/ilan/yalova-merkez-de-satilik-3-080-m-40-konut-imarli-arsa-19674488" rel="canonical"/><script type="application/ld+json">{"@context": "https://schema.org", "@graph": [{"@type": "Product", "url": "https://www.emlakjet.com/ilan/yalova-merkez-de-satilik-3-080-m-40-konut-imarli-arsa-19674488", "name": "Yalova Merkez De Satılık 3.080 M² %40 Konut İmarlı Arsa", "offers": {"@type": "Offer", "url": "https://www.emlakjet.com/ilan/yalova-merkez-de-satilik-3-080-m-40-konut-imarli-arsa-19674488", "price": 165000000, "priceCurrency": "TRY", "availability": "https://schema.org/InStock", "businessFunction": "http://purl.org/goodrelations/v1#Sell", "itemOffered": {"@id": "https://www.emlakjet.com/ilan/yalova-merkez-de-satilik-3-080-m-40-konut-imarli-arsa-19674488#listing"}}}, {"@type": "RealEstateListing", "@id": "https://www.emlakjet.com/ilan/yalova-merkez-de-satilik-3-080-m-40-konut-imarli-arsa-19674488#listing", "identifier": {"@type": "PropertyValue", "name": "İlan Numarası", "value": "19674488"}, "dateModified": "2026-10-30T20:41:19+03:00", "itemOffered": {"@type": "Residence", "floorSize": {"@type": "QuantitativeValue", "value": 3080, "unitCode": "MTK"}, "additionalProperty": [{"@type": "PropertyValue", "name": "Metrekare", "value": "3.080 m²"}, {"@type": "PropertyValue", "name": "Metrekare Birim Fiyatı", "value": "53571 TL/m²"}, {"@type": "PropertyValue", "name": "Tapu Durumu", "value": "Müstakil Tapulu"}, {"@type": "PropertyValue", "name": "Kategori", "value": "Satılık Konut İmarlı"}, {"@type": "PropertyValue", "name": "Krediye Uygunluk", "value": "Krediye Uygun"}, {"@type": "PropertyValue", "name": "Ada", "value": "513"}, {"@type": "PropertyValue", "name": "Parsel", "value": "7"}, {"@type": "PropertyValue", "name": "İmar Durumu", "value": "Konut İmarlı"}, {"@type": "PropertyValue", "name": "Kat Karşılığı", "value": "Verilemez"}, {"@type": "PropertyValue", "name": "Takas", "value": "Yok"}]}, "address": {"@type": "PostalAddress", "addressCountry": "TR", "streetAddress": "Hacımehmet Köyü", "addressLocality": "Merkez", "addressRegion": "Yalova"}}]}</script><script type="application/ld+json">{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Emlakjet", "item": "https://www.emlakjet.com/"}, {"@type": "ListItem", "position": 2, "name": "Satılık Konut İmarlı", "item": "https://www.emlakjet.com/satilik-konut-imarli-arsa"}, {"@type": "ListItem", "position": 3, "name": "Yalova Satılık Konut İmarlı", "item": "https://www.emlakjet.com/satilik-konut-imarli-arsa/yalova"}, {"@type": "ListItem", "position": 4, "name": "Yalova Merkez Satılık Konut İmarlı", "item": "https://www.emlakjet.com/satilik-konut-imarli-arsa/yalova-merkez"}, {"@type": "ListItem", "position": 5, "name": "Merkez Hacımehmet Köyü Satılık Konut İmarlı", "item": "https://www.emlakjet.com/satilik-konut-imarli-arsa/yalova-merkez-hacimehmet-koyu"}, {"@type": "ListItem", "position": 6, "name": "#19674488"}]}</script></head><body><main><article><h1 class="text-[1.0625rem] leading-6 font-semibold text-(--color-fg-default) md:text-xl md:leading-7" id="_R_blfiv6bqidaivbH1_">Yalova Merkez De Satılık 3.080 M² %40 Konut İmarlı Arsa</h1><div class="-order-1 flex items-center gap-1.5 sm:gap-3 flex-wrap" data-detail-compact-anchor="" id="price-sentinel"><span class="text-2xl leading-tight font-semibold whitespace-nowrap text-(--color-fg-default) md:text-3xl">165.000.000 ₺</span><span class="text-caption self-end">53.571 ₺/m²</span></div><button class="-order-1 flex w-full min-w-0 items-center gap-1.5 text-left text-sm text-(--color-fg-secondary)" data-widget-click="genel-bakis||haritada-gor" type="button"><span class="hide-scrollbar min-w-0 overflow-x-auto max-md:flex-1"><span class="block w-max min-w-full whitespace-nowrap">Hacımehmet, Merkez, Yalova</span></span> <span class="shrink-0 font-semibold text-(--color-brand-primary-500) md:ml-1.5">Haritada Gör</span></button><div class="transition-[box-shadow,border-color,background-color] duration-200 focus:outline-none overflow-hidden lg:bg-(--color-bg-default) lg:border lg:border-(--color-border-default) lg:rounded-card scroll-mt-36" id="features"><div class="lg:p-6 xl:p-8"><dl class="mb-4 grid grid-cols-[repeat(2,minmax(min-content,1fr))] gap-x-3 gap-y-4 lg:mb-5 lg:grid-cols-3 lg:gap-4"><div class="relative flex min-h-10 flex-col-reverse justify-center pl-12"><dt class="text-xs leading-tight text-(--color-fg-secondary)">Metrekare</dt><dd class="text-sm leading-tight font-semibold text-(--color-fg-default)">3.080 m²</dd></div><div class="relative flex min-h-10 flex-col-reverse justify-center pl-12"><dt class="text-xs leading-tight text-(--color-fg-secondary)">Metrekare Birim Fiyatı</dt><dd class="text-sm leading-tight font-semibold text-(--color-fg-default)">53571 TL/m²</dd></div><div class="relative flex min-h-10 flex-col-reverse justify-center pl-12"><dt class="text-xs leading-tight text-(--color-fg-secondary)">Tapu Durumu</dt><dd class="text-sm leading-tight font-semibold text-(--color-fg-default)">Müstakil Tapulu</dd></div></dl><div class="border-t border-(--color-border-default) lg:pt-4"><dl class="grid grid-cols-1 gap-x-8 sm:grid-cols-2"><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">İlan Numarası</dt><dd class="flex justify-end"><button class="inline-flex cursor-pointer items-center gap-1.5 text-right text-sm font-semibold text-(--color-brand-primary-900) transition-opacity hover:opacity-70" type="button">19674488</button></dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">İlan Güncelleme Tarihi</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)"><time>30 Ekim 2026</time></dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">Kategori</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)">Satılık Konut İmarlı</dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">Krediye Uygunluk</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)">Krediye Uygun</dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">Ada</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)">513</dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">Parsel</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)">7</dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">İmar Durumu</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)">Konut İmarlı</dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">Kat Karşılığı</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)">Verilemez</dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3 border-b-0"><dt class="text-sm text-(--color-fg-secondary)">Takas</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)">Yok</dd></div></dl></div><div class="mt-4 border-t border-(--color-border-default) pt-4"><div class="flex flex-col gap-4" id="_R_12mjurlfiv6bqidaivb_"><div><span class="mb-2.5 block text-xs font-medium tracking-wide text-(--color-fg-secondary) uppercase">Dış Özellikler</span><ul class="flex flex-wrap gap-2"><li class="surface-subtle inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-(--color-fg-default)">Kanalizasyon</li><li class="surface-subtle inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-(--color-fg-default)">Yolu Açılmış</li><li class="surface-subtle inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-(--color-fg-default)">Doğalgaz</li></ul></div><div><span class="mb-2.5 block text-xs font-medium tracking-wide text-(--color-fg-secondary) uppercase">Konum Özellikleri</span><ul class="flex flex-wrap gap-2"><li class="surface-subtle inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-(--color-fg-default)">Denize Yakın</li><li class="surface-subtle inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-(--color-fg-default)">Toplu Ulaşıma Yakın</li></ul></div></div></div></div></div></article></main></body></html>', 'expected': (165000000, 3080, 'residential', '513', '7', 'Hacımehmet')}, 'emlakjet-field': {'url': 'https://www.emlakjet.com/ilan/yalova-merkez-hacimehmet-te-asfalt-yola-cephe-ozel-konumlu-tarla-17517529', 'html': '<!DOCTYPE html>\n<html><head><link href="https://www.emlakjet.com/ilan/yalova-merkez-hacimehmet-te-asfalt-yola-cephe-ozel-konumlu-tarla-17517529" rel="canonical"/><script type="application/ld+json">{"@context": "https://schema.org", "@graph": [{"@type": "Product", "url": "https://www.emlakjet.com/ilan/yalova-merkez-hacimehmet-te-asfalt-yola-cephe-ozel-konumlu-tarla-17517529", "name": "Yalova Merkez Hacımehmet\'te Asfalt Yola Cephe Özel Konumlu Tarla", "offers": {"@type": "Offer", "url": "https://www.emlakjet.com/ilan/yalova-merkez-hacimehmet-te-asfalt-yola-cephe-ozel-konumlu-tarla-17517529", "price": 16500000, "priceCurrency": "TRY", "availability": "https://schema.org/InStock", "businessFunction": "http://purl.org/goodrelations/v1#Sell", "itemOffered": {"@id": "https://www.emlakjet.com/ilan/yalova-merkez-hacimehmet-te-asfalt-yola-cephe-ozel-konumlu-tarla-17517529#listing"}}}, {"@type": "RealEstateListing", "@id": "https://www.emlakjet.com/ilan/yalova-merkez-hacimehmet-te-asfalt-yola-cephe-ozel-konumlu-tarla-17517529#listing", "identifier": {"@type": "PropertyValue", "name": "İlan Numarası", "value": "17517529"}, "dateModified": "2026-11-24T08:53:07+03:00", "itemOffered": {"@type": "Residence", "floorSize": {"@type": "QuantitativeValue", "value": 5537, "unitCode": "MTK"}, "additionalProperty": [{"@type": "PropertyValue", "name": "Metrekare", "value": "5.537 m²"}, {"@type": "PropertyValue", "name": "Metrekare Birim Fiyatı", "value": "2980 TL/m²"}, {"@type": "PropertyValue", "name": "Tapu Durumu", "value": "Müstakil Tapulu"}, {"@type": "PropertyValue", "name": "Kategori", "value": "Satılık Tarla"}, {"@type": "PropertyValue", "name": "Krediye Uygunluk", "value": "Bilinmiyor"}, {"@type": "PropertyValue", "name": "Ada", "value": "131"}, {"@type": "PropertyValue", "name": "Parsel", "value": "25"}, {"@type": "PropertyValue", "name": "İmar Durumu", "value": "Tarla"}, {"@type": "PropertyValue", "name": "Kat Karşılığı", "value": "Verilemez"}, {"@type": "PropertyValue", "name": "Takas", "value": "Yok"}]}, "address": {"@type": "PostalAddress", "addressCountry": "TR", "streetAddress": "Hacımehmet Köyü", "addressLocality": "Merkez", "addressRegion": "Yalova"}}]}</script><script type="application/ld+json">{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Emlakjet", "item": "https://www.emlakjet.com/"}, {"@type": "ListItem", "position": 2, "name": "Satılık Tarla", "item": "https://www.emlakjet.com/satilik-tarla"}, {"@type": "ListItem", "position": 3, "name": "Yalova Satılık Tarla", "item": "https://www.emlakjet.com/satilik-tarla/yalova"}, {"@type": "ListItem", "position": 4, "name": "Yalova Merkez Satılık Tarla", "item": "https://www.emlakjet.com/satilik-tarla/yalova-merkez"}, {"@type": "ListItem", "position": 5, "name": "Merkez Hacımehmet Köyü Satılık Tarla", "item": "https://www.emlakjet.com/satilik-tarla/yalova-merkez-hacimehmet-koyu"}, {"@type": "ListItem", "position": 6, "name": "#17517529"}]}</script></head><body><main><article><h1 class="text-[1.0625rem] leading-6 font-semibold text-(--color-fg-default) md:text-xl md:leading-7" id="_R_blfiv6bqidaivbH1_">Yalova Merkez Hacımehmet\'te Asfalt Yola Cephe Özel Konumlu Tarla</h1><div class="-order-1 flex items-center gap-1.5 sm:gap-3 flex-wrap" data-detail-compact-anchor="" id="price-sentinel"><span class="text-2xl leading-tight font-semibold whitespace-nowrap text-(--color-fg-default) md:text-3xl">16.500.000 ₺</span><span class="text-caption self-end">2.980 ₺/m²</span></div><button class="-order-1 flex w-full min-w-0 items-center gap-1.5 text-left text-sm text-(--color-fg-secondary)" data-widget-click="genel-bakis||haritada-gor" type="button"><span class="hide-scrollbar min-w-0 overflow-x-auto max-md:flex-1"><span class="block w-max min-w-full whitespace-nowrap">Hacımehmet, Merkez, Yalova</span></span> <span class="shrink-0 font-semibold text-(--color-brand-primary-500) md:ml-1.5">Haritada Gör</span></button><div class="transition-[box-shadow,border-color,background-color] duration-200 focus:outline-none overflow-hidden lg:bg-(--color-bg-default) lg:border lg:border-(--color-border-default) lg:rounded-card scroll-mt-36" id="features"><div class="lg:p-6 xl:p-8"><dl class="mb-4 grid grid-cols-[repeat(2,minmax(min-content,1fr))] gap-x-3 gap-y-4 lg:mb-5 lg:grid-cols-3 lg:gap-4"><div class="relative flex min-h-10 flex-col-reverse justify-center pl-12"><dt class="text-xs leading-tight text-(--color-fg-secondary)">Metrekare</dt><dd class="text-sm leading-tight font-semibold text-(--color-fg-default)">5.537 m²</dd></div><div class="relative flex min-h-10 flex-col-reverse justify-center pl-12"><dt class="text-xs leading-tight text-(--color-fg-secondary)">Metrekare Birim Fiyatı</dt><dd class="text-sm leading-tight font-semibold text-(--color-fg-default)">2980 TL/m²</dd></div><div class="relative flex min-h-10 flex-col-reverse justify-center pl-12"><dt class="text-xs leading-tight text-(--color-fg-secondary)">Tapu Durumu</dt><dd class="text-sm leading-tight font-semibold text-(--color-fg-default)">Müstakil Tapulu</dd></div></dl><div class="border-t border-(--color-border-default) lg:pt-4"><dl class="grid grid-cols-1 gap-x-8 sm:grid-cols-2"><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">İlan Numarası</dt><dd class="flex justify-end"><button class="inline-flex cursor-pointer items-center gap-1.5 text-right text-sm font-semibold text-(--color-brand-primary-900) transition-opacity hover:opacity-70" type="button">17517529</button></dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">İlan Güncelleme Tarihi</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)"><time>24 Kasım 2026</time></dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">Kategori</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)">Satılık Tarla</dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">Krediye Uygunluk</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)">Bilinmiyor</dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">Ada</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)">131</dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">Parsel</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)">25</dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">İmar Durumu</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)">Tarla</dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3"><dt class="text-sm text-(--color-fg-secondary)">Kat Karşılığı</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)">Verilemez</dd></div><div class="flex items-center justify-between gap-3 border-b border-(--color-border-default) py-3 border-b-0"><dt class="text-sm text-(--color-fg-secondary)">Takas</dt><dd class="text-right text-sm font-semibold break-words text-(--color-fg-default)">Yok</dd></div></dl></div><div class="mt-4 border-t border-(--color-border-default) pt-4"><div class="flex flex-col gap-4" id="_R_12mjurlfiv6bqidaivb_"><div><span class="mb-2.5 block text-xs font-medium tracking-wide text-(--color-fg-secondary) uppercase">Dış Özellikler</span><ul class="flex flex-wrap gap-2"><li class="surface-subtle inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-(--color-fg-default)">Parselli</li><li class="surface-subtle inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-(--color-fg-default)">Yolu Açılmış</li><li class="surface-subtle inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-(--color-fg-default)">Doğalgaz</li></ul></div><div><span class="mb-2.5 block text-xs font-medium tracking-wide text-(--color-fg-secondary) uppercase">Konum Özellikleri</span><ul class="flex flex-wrap gap-2"><li class="surface-subtle inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-(--color-fg-default)">Toplu Ulaşıma Yakın</li></ul></div></div></div></div></div></article></main></body></html>', 'expected': (16500000, 5537, 'field', '131', '25', 'Hacımehmet')}}

REQUEST = SimpleNamespace(province="Yalova", district="Merkez", place="Hacımehmet", place_kind="köy", block="1295", parcel="4", zoning="unknown")


def fixture(name, structured=True):
    data=FIXTURES[name]
    soup=BeautifulSoup(data["html"], "html.parser")
    if not structured:
        for script in soup.select("script"):script.decompose()
    return soup


def parse(name, soup=None, request=REQUEST):
    data=FIXTURES[name]
    source="RE/MAX" if name.startswith("remax") else "Emlakjet"
    return listing_readers.parse_detail(str(soup) if soup is not None else data["html"], data["url"], request, source)


class ListingReaderTests(unittest.TestCase):
    def assert_observed_fields(self, name, row):
        self.assertIsNotNone(row, name)
        price,area,kind,block,parcel,place=FIXTURES[name]["expected"]
        self.assertEqual(row["price"],price,name)
        self.assertEqual(row["area"],area,name)
        self.assertEqual(row["kind"],kind,name)
        self.assertEqual(str(row["block"]),block,name)
        self.assertEqual(str(row["parcel"]),parcel,name)
        self.assertEqual(row["address"]["province"],"Yalova")
        self.assertEqual(row["address"]["district"],"Merkez")
        self.assertIn(place,row["address"]["place"])
        self.assertTrue(row["detail_verified"])
        self.assertTrue(row["live"])
        self.assertTrue(row["reader"])
        self.assertAlmostEqual(row["unit"],price/area)

    def test_observed_listings_extract_correctly(self):
        for name in FIXTURES:
            with self.subTest(source=name):self.assert_observed_fields(name,parse(name))

    def test_observed_dom_is_readable_without_jsonld(self):
        for name in FIXTURES:
            with self.subTest(source=name):self.assert_observed_fields(name,parse(name,fixture(name,structured=False)))

    def test_marketing_title_does_not_override_explicit_address(self):
        row=parse("remax-500")
        self.assertIn("HACIMEHMET",row["title"])
        self.assertIn("Kazım Karabekir",row["address"]["place"])
        self.assertNotIn("Hacımehmet",row["address"]["place"])

    def test_recommended_price_before_listing_is_ignored(self):
        for name in FIXTURES:
            with self.subTest(source=name):
                soup=fixture(name,structured=False)
                aside=soup.new_tag("aside")
                aside.append(BeautifulSoup('<h2>Benzer ilanlar</h2><h3>99.999.999 TL</h3><p>999 m²</p>','html.parser'))
                soup.body.insert(0,aside)
                self.assert_observed_fields(name,parse(name,soup))

    def test_unit_price_cannot_replace_total_price(self):
        soup=fixture("emlakjet-residential",structured=False)
        price=soup.select_one("#price-sentinel")
        distractor=soup.new_tag("div");distractor.string="m² Fiyatı 53.571 TL"
        price.insert_before(distractor)
        self.assertEqual(parse("emlakjet-residential",soup)["price"],165000000)

    def test_dom_total_price_accepts_currency_prefix(self):
        soup=fixture("emlakjet-residential",structured=False)
        price=soup.select_one("#price-sentinel span")
        price.string="₺ 165.000.000"
        self.assertEqual(parse("emlakjet-residential",soup)["price"],165000000)

    def test_dom_area_keeps_turkish_decimal_separator(self):
        soup=fixture("emlakjet-residential",structured=False)
        label=soup.find("dt",string="Metrekare")
        label.parent.find("dd").string="3.080,94 m²"
        self.assertEqual(parse("emlakjet-residential",soup)["area"],3080.94)

    def test_explicit_zoning_after_generic_category_is_used(self):
        soup=fixture("emlakjet-residential",structured=False)
        soup.h1.string="Yalova Merkez Satılık Arsa"
        label=soup.find("dt",string="Kategori")
        label.parent.find("dd").string="Satılık Arsa"
        self.assertEqual(parse("emlakjet-residential",soup)["kind"],"residential")

    def test_missing_parcel_fields_are_not_invented_from_title(self):
        soup=fixture("emlakjet-residential",structured=False)
        for key in ("Ada","Parsel"):
            soup.find("dt",string=key).parent.decompose()
        soup.h1.string="Hacımehmet 1295 ada 4 parsel yakınında satılık arsa"
        row=parse("emlakjet-residential",soup)
        self.assertIsNotNone(row)
        self.assertIsNone(row["block"])
        self.assertIsNone(row["parcel"])
        self.assertIsNone(row.get("distance"))

    def test_grouped_block_number_accepts_only_valid_thousands_groups(self):
        # Observed RE/MAX cadastral fields use 1.337 for block 1337.
        for displayed, expected in [("1.337", "1337"), ("1.33", None)]:
            with self.subTest(displayed=displayed):
                soup=fixture("remax-500",structured=False)
                label=soup.find("div",class_="property-detail-label",string="Ada")
                label.parent.find("div",class_="property-detail-value").string=displayed
                row=parse("remax-500",soup)
                self.assertIsNotNone(row)
                self.assertEqual(row["block"],expected)
                self.assertEqual(row["parcel"],"15")

    def test_shared_ownership_is_flagged_without_changing_advertised_area(self):
        cases=[("Müstakil Parsel","Satılık Konut İmarlı Arsa",False),
               ("Hisseli Tapu","Satılık Konut İmarlı Arsa",True),
               ("Müstakil Parsel","Satılık Arsa Hissesi",True)]
        for ownership,title,expected in cases:
            with self.subTest(ownership=ownership,title=title):
                soup=fixture("remax-500",structured=False)
                soup.h1.string=title
                label=soup.find("div",class_="property-detail-label",string="Tapu Durumu")
                label.parent.find("div",class_="property-detail-value").string=ownership
                row=parse("remax-500",soup)
                self.assertIsNotNone(row)
                self.assertEqual(row["share_sale"],expected)
                self.assertEqual(bool(row["share_evidence"]),expected)
                self.assertEqual(row["area"],500)
                self.assertEqual(row["price"],7600000)
                self.assertEqual(row["unit"],15200)

    def test_wrong_province_does_not_become_local_comparable(self):
        request=SimpleNamespace(**{**vars(REQUEST),"province":"Bursa"})
        self.assertIsNone(parse("emlakjet-residential",request=request))

    def test_canonical_identity_mismatch_is_rejected(self):
        data=FIXTURES["emlakjet-field"]
        self.assertIsNone(listing_readers.parse_detail(data["html"],data["url"].replace("17517529","99999999"),REQUEST,"Emlakjet"))

    def test_explicitly_unavailable_offer_is_rejected(self):
        for name in FIXTURES:
            with self.subTest(source=name):
                soup=fixture(name)
                for script in soup.select('script[type="application/ld+json"]'):
                    if script.string:script.string=script.string.replace("https://schema.org/InStock","https://schema.org/OutOfStock")
                self.assertIsNone(parse(name,soup))

    def test_emlakjet_search_includes_village_suffix_and_district(self):
        urls=listing_readers.search_urls(REQUEST,"Emlakjet")
        self.assertIn("https://www.emlakjet.com/satilik-arsa/yalova-merkez-hacimehmet-koyu",urls)
        self.assertIn("https://www.emlakjet.com/satilik-arsa/yalova-merkez",urls)

    def test_candidate_discovery_has_no_twelve_link_truncation(self):
        urls=["https://remax.com.tr/tr/portfoy/P"+str(10000000+i) for i in range(30)]
        html="<main>"+"".join('<a href="'+url+'">Satılık arsa</a>' for url in urls)+"</main>"
        result=listing_readers.candidates(html,"https://remax.com.tr/tr/arsa-arazi/satilik/yalova/merkez",REQUEST,"RE/MAX")
        self.assertEqual(set(result),set(urls))

    def test_candidate_discovery_excludes_offsite_links(self):
        url=FIXTURES["emlakjet-field"]["url"]
        html='<a href="'+url+'">Satılık Tarla</a><a href="https://example.com/ilan/arsa-123">Satılık</a><a href="javascript:alert(1)">İlan</a>'
        result=listing_readers.candidates(html,"https://www.emlakjet.com/satilik-arsa/yalova-merkez",REQUEST,"Emlakjet")
        self.assertEqual(set(result),{url})


class RadiusTests(unittest.TestCase):
    def test_exact_one_kilometer_boundary_uses_unrounded_distance(self):
        from server import SEARCH_RADIUS_METERS, within_radius
        self.assertEqual(SEARCH_RADIUS_METERS,1000)
        for distance,expected in [(0,True),(999.9,True),(1000.0,True),(1000.4,False),(1001,False)]:
            with self.subTest(distance=distance):
                self.assertEqual(within_radius({"center":[40.64,29.25],"distance":round(distance),"distance_m":distance}),expected)

    def test_missing_exact_distance_is_not_eligible(self):
        from server import within_radius
        self.assertFalse(within_radius({"center":None,"distance":None,"distance_m":None}))


if __name__ == "__main__":
    unittest.main()
