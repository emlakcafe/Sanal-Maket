# Emlak Cafe mobile preview

This branch runs the isolated Python preview at https://emlak-cafe-ai-mobil-test.onrender.com. The main application's branch and data are separate.

## Running and checking

Install `requirements.txt`, then run `uvicorn server:app --host 0.0.0.0 --port 8000`.
Run regression checks with `python -m unittest discover -s tests -v`.

## Listing readers

`listing_readers.py` contains separate, deterministic readers for the two current live sources:

- RE/MAX: identity-matched RealEstateListing JSON-LD, explicit address breadcrumbs and labelled `.property-detail-row` elements. A bounded header selector is the price fallback.
- Emlakjet: matching Product offers plus RealEstateListing property/address data. The article containing the main heading supplies `dt`/`dd` fields when structured data is missing. Village and neighbourhood routes retain their suffixes.

These rules are validated against minimal observed page fixtures. They do not train a model, invent missing fields, or claim to support every listing platform. New formats need a reader and a regression fixture.

Only allowed public paths are requested with a transparent user agent. Redirects stay on the source host and are checked against its robots rules. A source restriction stops further queued requests. Each source has a bounded total time and at most 40 detail pages; the response reports actual attempts, successful detail reads and limitations. Completed reads survive timeouts.

## Parcel matching and valuation

`SEARCH_RADIUS_METERS = 1000` is the single backend radius and is returned to the map. Unrounded verified parcel-centre distances determine inclusion. Listing map pins only prioritize checks; they never become verified parcel coordinates.

Each listing uses its own explicit address for TKGM resolution. Identical ada/parsel numbers in different localities remain distinct; cross-source duplicates retain their original links. A detail page must supply price and area, and its parcel area must agree with TKGM before its distance is accepted.

Price ranges use only comparable parcels within 1 km, require at least three observations, and remain conditional when zoning is unknown. Asking prices are not completed-sale prices. A page read is not a guarantee that the property is unsold. Missing, conflicting or unreadable fields are displayed as such.

The original dated Akköy observations remain explicitly labelled as research from 2026-11-26. They are not silently promoted to current listings.
