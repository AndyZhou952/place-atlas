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

Cloudflare D1 stores restaurant identity, coordinates, sources, personal ratings, visits, and photo metadata. R2 stores images. Personal ratings and external ratings are independent fields. Updating one must preserve the others.

Nearby compares only saved restaurants. Coordinates permit a distance prefilter; an optional route provider supplies walking time. An unavailable route provider must not turn straight-line distance into a claimed travel time.

## Module boundaries

- `apps/web/app`: browser routes and HTTP endpoints.
- `apps/web/components` and `apps/web/features`: interface components.
- `apps/web/product`: executable domain/application code, not planning documents.
- `apps/web/adapters`: storage, model, search, and external integrations.
- `apps/web/agent`: the bounded model/search loop, evidence checks, and live smoke runner.
- `apps/web/route-sidecar`: optional private route-provider Worker.
- `apps/web/evals`: benchmark datasets and scorers.

The application runs its research adapter inside the Worker. External clients can use application interfaces without a required messaging platform. The root README contains complete setup instructions. These notes describe ownership boundaries, not a claim that every enrichment field has passed live evaluation.

Search is provider-independent from the model. With no search credential, the tool reads DuckDuckGo HTML result snippets from a fixed endpoint. Supplying `SEARCH_API_KEY` selects Tavily. Both paths feed source excerpts into the same bounded research loop and evidence validation. HTML changes, rate limits, and challenges can make the no-key path unavailable; they do not authorize challenge bypass or unsupported claims.

## Design reference and current limits

### Research responsibilities and prompt

The runtime loads `apps/web/agent/research-instructions.ts`, a versioned prompt and search-tool description. It is deliberately a small component rather than a second orchestration framework. The selected branch and user hint are supplied as data; search excerpts are untrusted tool results.

The application resolves identity and owns confirmation/persistence. The model plans targeted searches, interprets source evidence, and proposes structured facts. Tabelog's exact restaurant listing supplies the aggregate rating; individual reviews and ranking pages are not rating sources. Branch-specific official sites or their linked booking pages are preferred for reservation rules, with Tabelog as fallback. Booking availability, queues, and required lead times are separate facts, not deductions from popularity or a booking button.

Only `search_web` is currently exposed to the research model. Its description specifies query examples, result shape and budget. The application can augment each search with one discovered Tabelog main listing: fixed HTTPS host/path, no redirects, five-second read timeout within the shared deadline, one MiB body cap, and only the matching Restaurant JSON-LD aggregate rating and address. Individual reviews are discarded. A general official-site reading tool is not implemented; the model does not receive full pages. Search failures are returned as tool outcomes so other supported facts survive; all searches failing remains unavailable. The model cannot confirm or write a restaurant. Existing authenticated application APIs perform writes only after owner confirmation.

Source priority is currently a prompt instruction, not a deterministic proof of official-domain ownership. Code separately checks quoted evidence, branch anchors, score tokens, main-listing URLs, and the output schema. Live evaluation must establish the quality of the combined system. Track incomplete implementation and validation in `docs/status.md`.

The relevant guidance from [the agent-book skills proposal](https://github.com/bojieli/ai-agent-book/pull/1137) is goal-oriented tools, bounded execution, untrusted-source isolation, explicit failure handling, and independent evaluation. The repository does not copy or depend on the 22 skill packages.

The current loop enriches an already selected identity with Tabelog and reservation evidence. Candidate discovery still requires Google Places; Google-free agent discovery, full-page research, and live benchmark acceptance remain follow-up work. A successful offline test is not evidence that these follow-up capabilities work.
