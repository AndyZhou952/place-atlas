# Application architecture

The browser calls authenticated application APIs. The application owns restaurant research, structured proposals, confirmation, persistence, and the resulting map view. Model providers implement an OpenAI-compatible HTTP interface and are interchangeable configuration choices.

## Add

1. Accept a short restaurant hint and optional neighborhood.
2. Search for real identities and resolve the branch. Ask a focused question when multiple branches remain plausible.
3. Collect search evidence and deterministic location evidence. Let the model extract structured facts from those sources. Search excerpts may be augmented with structured branch identity and aggregate rating from a discovered Tabelog main listing.
4. Validate the proposal and display a concise preview. Missing optional facts remain unknown; research failure does not erase the session.
5. On confirmation, persist through the application write service. Return the saved item ID and refresh the map/list.

The model proposes facts; application code validates and commits them. Source text is untrusted input. A page cannot authorize a write or change the restaurant under investigation. Retries have bounded budgets and confirmation is idempotent.

## Storage and views

Cloudflare D1 stores restaurant identity, coordinates, sources, personal ratings, visits, and media metadata. R2 stores uploaded images and videos. Personal ratings and external ratings are independent fields. Updating one must preserve the others. A Google Places rating requested for a saved overseas place is read on demand from its persisted Place ID and returned only in a private, no-store response; it is not written by that read path.

Nearby compares only saved restaurants. Coordinates permit a distance prefilter; an optional route provider supplies walking time. An unavailable route provider must not turn straight-line distance into a claimed travel time.

## Module boundaries

- `apps/web/app`: browser routes and HTTP endpoints.
- `apps/web/components` and `apps/web/features`: interface components.
- `apps/web/product`: executable domain/application code, not planning documents.
- `apps/web/adapters`: storage, model, search, and external integrations.
- `apps/web/agent`: the bounded model/search loop, evidence checks, and live smoke runner.
- `apps/web/route-sidecar`: optional private route-provider Worker.
- `apps/web/evals`: benchmark datasets and scorers.

The application runs its research adapter inside the Worker. External clients can use application interfaces without a required messaging platform. A dedicated Bearer token permits only the four Add operations through `/api/agent/catalog-intake`. The token is checked before request parsing or application creation, and its conversation is separate from browser owner-cookie conversations. The external route calls the same Add coordinator and confirmation service; it does not expose general catalog, personal or media writes. The root README contains setup instructions. These notes describe ownership boundaries, not a claim that every enrichment field has passed live evaluation.

Search is provider-independent from the model. With no search credential, Japanese/Tabelog queries use Yahoo Japan and other queries use DuckDuckGo, each through a fixed public endpoint. Supplying `SEARCH_API_KEY` selects Tavily. All paths feed source excerpts into the same bounded research loop and evidence validation. HTML changes, rate limits, and challenges can make the no-key path unavailable; they do not authorize challenge bypass or unsupported claims. Requests use manual redirects and reject non-success responses so credentials cannot follow arbitrary redirects; the Workers runtime does not support the `error` redirect mode used by standard Node fetch.

## Design reference and current limits

### Research responsibilities and prompt

The runtime loads `apps/web/agent/research-instructions.ts`, a versioned prompt and search-tool description. It is deliberately a small component rather than a second orchestration framework. The selected branch and user hint are supplied as data; search excerpts are untrusted tool results.

The application resolves identity and owns confirmation/persistence. The model plans targeted searches, interprets source evidence, and proposes structured facts. Tabelog's exact restaurant listing supplies the aggregate rating; individual reviews and ranking pages are not rating sources. Branch-specific official sites or their linked booking pages are preferred for reservation rules, with Tabelog as fallback. Booking availability, queues, and required lead times are separate facts, not deductions from popularity or a booking button.

Only `search_web` is exposed as a model-callable tool. Its description specifies query examples, result shape and budget. The application can augment searches with a discovered Tabelog main listing: fixed HTTPS host/path, no redirects, bounded read, and only the matching Restaurant JSON-LD identity, aggregate rating, address, coordinates and restaurant facts. Individual reviews are discarded. A branch-verified structured listing can still supply its parsed facts if the model response fails; another listing cannot. For an overseas Google selection, the application can read the selected Place ID's request-scoped website hint, then up to four bounded public pages on that HTTPS origin. A contact page may establish the exact unit while a separately titled branch page supplies cuisine or an explicit booking link; cross-page evidence must pass the branch-title check. The model receives bounded extracted text, not unrestricted browsing. Search failures remain explicit outcomes; an exact-branch official source can supply facts even when public search is blocked. The model cannot confirm or write a restaurant. Existing authenticated application APIs perform writes only after owner confirmation.

The first research query is selected by the candidate address region: Tabelog for Japan and official reservation evidence elsewhere. The model prompt guides later searches. Code separately checks quoted evidence, branch anchors (including a complete owner-entered Japanese name for a romanized Google selection), postal identity when available (or a matching distinctive building name when a commercial-building postal code differs), score tokens, main-listing URLs, and the output schema. A selected Place ID's website hint narrows an official-source search, but the hint alone does not prove a restaurant fact. A saved or active-preview Google Place ID can drive an owner-only, metered, no-store rating read; mainland China is skipped and Japan prefers an available Tabelog score. Live evaluation must establish the quality of the combined system. Track incomplete implementation and validation in `docs/status.md`.

The relevant guidance from [the agent-book skills proposal](https://github.com/bojieli/ai-agent-book/pull/1137) is goal-oriented tools, bounded execution, untrusted-source isolation, explicit failure handling, and independent evaluation. The repository does not copy or depend on the 22 skill packages.

The current loop enriches an already selected identity with Tabelog, official-site and reservation evidence. Google Places is preferred when configured; otherwise a no-key Tabelog discovery adapter exists for Japanese restaurant listings. Discovery and research share `RestaurantSourceReader`. The PoC selects `RESTAURANT_SOURCE_READER=firecrawl`: fresh raw listing HTML, fixed provider endpoint, exact requested/final URL validation, two-MiB body cap, 15-second provider timeout and 20-second client timeout bounded by the parent signal. When that transport fails or returns a verified listing without coordinates, one bounded direct read of the same listing may recover it; the first valid facts survive a failed fallback. `FIRECRAWL_API_KEY` is optional; anonymous service quotas are an operational dependency. Without that selector, ordinary Tabelog reads use the optional Cloudflare Browser Run fallback. Challenge HTML is rejected even when transport reports HTTP 200. The overseas official-site reader is a separate request-scoped path. Broader live benchmark acceptance remains open. Source adapters are in `apps/web/agent/` and `apps/web/adapters/providers/`; progress is tracked in `docs/status.md`.

On confirmation, a newly complete preview can promote an existing review candidate with the same strong identity into the public catalog. The publisher retains the original item ID and identity creation audit, updates evidence snapshots and removes the review candidate in the same D1 batch as the confirmation receipt and revision increment. Existing public items are reused without overwriting their profile or personal data. The preview/revision checks, per-attempt claim and durable receipt protect races and retries.
