# Emlak Cafe mobile preview

This branch runs the isolated Python preview at https://emlak-cafe-ai-mobil-test.onrender.com. The main application's branch and data are separate.

## Running and checking

Install `requirements.txt`, then run `uvicorn server:app --host 0.0.0.0 --port 8000`.
Run regression checks with `python -m unittest discover -s tests -v`.

## Regional asking-price analysis (V10.6)

The result now has a separate `regional_analysis` section. A TKGM refusal or an
insufficient verified 1 km sample no longer hides every available price signal.
Only records whose own listing evidence matches the selected province, district
and locality enter this regional sample. Residential land and agricultural land
remain separate. Shared sales, completed buildings, dated snapshots, ambiguous
numeric observations and conflicting equal-quality duplicates are excluded.

At least three eligible deduplicated observations in a group produce its observed
minimum/maximum, median and middle-half (Q25–Q75) asking price per m². Each included
record retains its source links and whether the evidence was a direct page read
or an unverified search-index observation. The regional summary has **no 1 km
distance claim** and is not evidence of a completed sale or a guaranteed buying
price. It does not change the strict map/valuation eligibility rules.

When the current query supplies a verified TKGM area, regional samples are limited
to 0.5–2 times that area and can show a conditional area-scaled indication. Without
that area, only unit prices are shown: the code never silently borrows a previous
parcel size. Unknown zoning is disclosed and categories are never averaged together.

Identical concurrent catalogue requests share one network operation. HTTP 403/429
refusals are not retried; a cooldown of at least two minutes respects a longer
`Retry-After`. User-facing source errors explain the limitation without raw request
URLs or technical stack details. No alternate source route or account session is used.

Additional UI checks: `node tests/test_regional_ui.js`.

## On-demand research agents (V10.5 foundation)

The main form now starts a real server job using `POST /api/agent-runs` and polls
`GET /api/agent-runs/{job_id}`. Six rules-and-tools agents run the parcel lookup,
web discovery, RE/MAX reads, Emlakjet reads, cadastral matching and valuation.
Their status and counts are updated by the executing operations; the UI does
not simulate progress or describe these tasks as six language models. They run
when a query is requested, not continuously in the background.

Public-index discovery uses Exa's documented keyless MCP trial at
`https://mcp.exa.ai/mcp`. It calls only `web_search_exa`, with up to three queries,
a 36-second deadline and a five-minute parcel-bound cache. The query objective
uses the server's TKGM area, nature and coordinates when available. There is no API key,
personal account, paid registration or `agent_run` call. Exa is explicitly named
as the search provider. Google AI remains the separate optional integration
described below; Exa results are never called Google results.

Search records are filtered for local land-listing evidence and safe public
links. The reader receives only approved RE/MAX and Emlakjet detail URLs from
discovery; it obtains price, area and address independently from the actual
permitted page. Unsupported-source results remain labelled index candidates,
without verified activity, distance or a place on the parcel map. A category
page is not assigned an individual listing's price. Built apartments/villas and
construction areas are not land comparables. Source records are not necessarily
unique properties; verified duplicates are merged by cadastral identity.

There is no direct Sahibinden request in this workflow. An absent Sahibinden
index result does not imply the area has no Sahibinden listings. Free trial
availability and coverage are limited; a 403/429 stops the search rather than
retrying or changing identity, while other permitted readers can finish.

The job runtime permits two concurrent jobs, retains at most 32 jobs for fifteen
minutes in process memory, and enforces a 140-second total deadline. Restarting
the service discards jobs. All job endpoints send `Cache-Control: no-store`.
The old `/api/analyze` endpoint remains compatible with earlier clients.

The map distinguishes the count of nearby listings from the number eligible
for a price calculation. Every listing includes its acceptance/exclusion reason.
Unknown zoning remains a condition on any reference range, and insufficient
comparables never produce an invented estimate.

When an advertised postal locality is absent from the cadastral catalogue, a
narrow alternative match can be considered only if the listing itself names
the selected cadastral locality, supplies a nearby map pin and is a current
detail read with no share/multiple-parcel flags. The official block/parcel must
agree within 2% in area and within 150 metres of the advertised pin. The original
postal address is preserved, and the qualified matching method and pin difference
are shown. This does not assert an official equivalence between locality names
or that the advertised pin lies inside the parcel.

UI checks: `node tests/test_agent_ui.js`.

Official search access reference: https://exa.ai/docs/get-started/exa-mcp

## Listing readers

`listing_readers.py` contains separate, deterministic readers for the two current live sources:

- RE/MAX: identity-matched RealEstateListing JSON-LD, explicit address breadcrumbs and labelled `.property-detail-row` elements. A bounded header selector is the price fallback.
- Emlakjet: matching Product offers plus RealEstateListing property/address data. The article containing the main heading supplies `dt`/`dd` fields when structured data is missing. Village and neighbourhood routes retain their suffixes.

These rules are validated against minimal observed page fixtures. They do not train a model, invent missing fields, or claim to support every listing platform. New formats need a reader and a regression fixture.

Only allowed public paths are requested with a transparent user agent. Redirects stay on the source host and are checked against its robots rules. A source restriction stops further queued requests. Each source has a bounded total time and at most 40 detail pages; the response reports actual attempts, successful detail reads and limitations. Completed reads survive timeouts.

## Parcel matching and valuation

`SEARCH_RADIUS_METERS = 1000` is the single backend radius and is returned to the map. Unrounded verified parcel-centre distances determine inclusion. Listing map pins only prioritize checks; they never become verified parcel coordinates.

Each listing uses its own explicit address for TKGM resolution. Identical ada/parsel numbers in different localities remain distinct; cross-source duplicates retain their original links. A detail page must supply price and area, and its parcel area must agree with TKGM before its distance is accepted.

The verified parcel price range uses only comparable parcels within 1 km, requires at least three observations, and remains conditional when zoning is unknown. The separately labelled regional summary described above can include same-locality observations outside 1 km or without verified distance. Asking prices are not completed-sale prices. A page read is not a guarantee that the property is unsold. Missing, conflicting or unreadable fields are displayed as such.

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
