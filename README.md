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

## Google research trial (V10.4)

The Google research panel follows the selected parcel's main analysis. When the
Google connection and pilot access code are ready, it runs once automatically
after a successful parcel analysis. It uses the
Gemini Developer API with `google_search`; it does not automate the Google AI Mode
website or use a personal Sahibinden session. `/api/analyze`, its readers, TKGM
matching and the 1,000 metre valuation rules remain independent. Research results
are never inserted into `items`, the map, or a price-history database.

### Server configuration

- `GEMINI_API_KEY`: a Gemini project key, kept only in the server environment.
- `GOOGLE_RESEARCH_ACCESS_TOKEN`: a separate random access code of at least 24
  characters. This protects the paid endpoint of the public preview. The user
  enters this access code in the research panel, never the Google API key.
- `GEMINI_MODEL`: optional; defaults to `gemini-3.5-flash-lite`.

Both credentials must be configured before research is available. The default
unconfigured state makes no external request. `GET /api/research/status` reports
configuration status, including credential-presence booleans, without returning
secret values. `POST /api/research` accepts the same property fields as
`/api/analyze`, its optional `research_context_id` as `context_id`, and the access
code in the `X-Research-Code` header. The short-lived, selection-bound context
reuses the exact server-held TKGM observation rather than trusting browser-supplied
area or coordinates. A supplied expired or mismatched context makes no research
request. A configuration check is not a live connectivity test.

Without a configured Google connection, the UI prepares an ordinary external
Google search link from the actual TKGM result, including the selected address,
block/parcel, area, nature, coordinates and the 1 km request. It opens Google in
a new tab only when the user clicks it. This fallback does not embed Google's
answer in the app, does not fabricate a report, and is labelled accordingly.

Google Search grounding for this model requires a paid Google project. No project
is created, billing enabled, key purchased, or provider called by this code change
or its offline tests. The Google AI Mode consumer app and the Gemini API can return
different sources and answers. Use an actual configured pilot before claiming
coverage for any neighbourhood or platform.

### Cost and request limits

There is one research request at a time, a 50-second provider timeout, a bounded
output size, and at most 20 research attempts per UTC day **per running process**.
This counter resets after a restart/deployment; it is not a billing hard cap or a
persistent daily quota. Configure provider-side quotas for the pilot. A single
Gemini report may execute multiple billable Google queries; returned query strings
are not a billing meter. Provider failures are not automatically retried and do
not silently switch to another paid service.

### Source display and storage

The complete generated text is displayed with inline and aggregate source links.
Citation byte offsets are resolved against the original text part, including
Turkish and emoji characters. Google Search Suggestions retain their supplied
HTML/CSS in an isolated iframe that cannot execute scripts or access the parent
page. A restrictive iframe CSP prevents arbitrary origin loads.

Missing grounding is an explicit unavailable report, never a successful zero-ads
search. An inaccessible or old search result does not establish listing activity,
EIDS verification, zoning or a verified 1 km distance. Unknown parcel information
remains unknown. The report's claims are not promoted into the deterministic
valuation engine.

Reports have `Cache-Control: no-store`, are not written to server/browser storage,
and are cleared when the selected property changes or the page is left. No source
URL is fetched by the research integration. Link harvesting and building a listing
database from Google Grounding output are not part of this implementation.

Official integration and display references:

- https://ai.google.dev/gemini-api/docs/google-search
- https://firebase.google.com/docs/ai-logic/grounding-google-search
- https://ai.google.dev/gemini-api/terms#grounding-with-google-search
- https://ai.google.dev/gemini-api/docs/pricing
