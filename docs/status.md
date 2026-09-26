# Implementation and verification status

Updated: 2026-09-26. This tracks repository implementation separately from deployment and product acceptance. "Implemented" does not mean "verified live". No production deployment is part of this update.

## Completed in the repository

| Area | Implemented | Evidence / boundary |
| --- | --- | --- |
| Standalone setup | Inline README instructions for credentials, Cloudflare resources, owner secrets, deployment, then website usage | Owner password is a server secret, not a first-run website registration flow |
| Repository cleanup | Removed obsolete root planning directories, channel-specific integrations, and external relay packages | Live domain code remains under `apps/web/product` |
| Agent ownership | Research runs in `apps/web/agent` with a configurable OpenAI-compatible endpoint | No external agent platform required |
| Search | Default no-key DuckDuckGo snippets; optional Tavily | Live search worked on the development host; HTML access is best effort |
| Bounded tool loop | Two searches, three model turns, timeout, multiple tool calls, validated evidence, no direct writes | Offline tests cover failure and unsupported-tool cases |
| Research instructions | Versioned prompt and tool description with Tabelog aggregate-score and official-reservation source rules | Main-listing URL guard rejects individual review pages; official-source precedence still relies on model reasoning |
| Structured Add | Browser discover/select/preview/confirm APIs, scoped sessions, duplicate prevention, shared publication path | Local integration tests cover confirmation and catalog visibility; discovery still needs Google Places |
| API discovery | `/api/agent/capabilities` exposes Add operations, required fields, owner-session authentication, conversation header, and confirmation boundary | This documents existing authenticated APIs; it does not add an unauthenticated write path or external-agent bearer tokens |
| Existing personal records | Owner authorization, personal scores, visits, notes and media APIs | Do not interpret this as fresh acceptance of every editing interaction |
| Evaluation assets | Resolution/enrichment datasets, scorers, mocked regressions, live smoke runner | Example predictions validate scoring code, not model accuracy |

## Implemented but pending verification

- Run the revised prompt on real restaurant cases. Prompt wording and mocked tests do not prove source selection accuracy.
- Verify DuckDuckGo access from the deployed Cloudflare runtime, not only the development host.
- Measure actual Tabelog aggregate-score coverage and accuracy. Never count individual-review scores as restaurant scores.
- Verify official-site identity, reservation precedence, conflicting policies, and explicit booking lead times.
- Run the complete browser flow: short hint → correct branch → useful preview → confirmation → visible list/map after refresh; repeat confirmation without duplication.
- Recheck personal and external rating independence and photo editing in the deployed browser.

Latest live evidence: `apps/web/evals/place-enrichment/live-smoke-2026-09-26.json`. DeepSeek and two no-key searches completed in about four seconds, but both enrichment fields stayed unknown. Transport passed; restaurant enrichment did **not** pass. This predates the revised source-aware prompt. No database write occurred.

## Pending implementation, in priority order

1. **Read useful source content.** Add a bounded source-reading tool restricted to discovered public URLs, with redirect/address checks, content limits, clear truncation, and explicit blocked/timeout results. Do not bypass challenges. Search snippets alone often omit ratings or booking rules.
2. **Make failures actionable.** Preserve the selected restaurant/session, expose missing evidence and provider errors, and allow a bounded focused retry instead of requesting already supplied details again.
3. **Complete Add enrichment.** Connect categories, signature dishes, official links, and Google ratings where appropriate through research, preview, persistence, and UI together. Reservation lead-time fields already exist in the application model; the narrow research prompt does not populate them yet. Do not silently output fields the application cannot store.
4. **Remove discovery's Google dependency.** Add and evaluate another identity-discovery path before advertising Google-free Add.
5. **Improve frontend records and Nearby.** Finish visit/photo editing consistency, then saved-place-only agent recommendations with verified route times and clear uncertainty. Keep these separate from Add acceptance.
6. **Later:** screenshot input, wider provider compatibility, performance work, and deployment-quality monitoring.

## Acceptance before deployment

- Regression tests, typecheck, lint, and build pass.
- Live predictions are evaluated against independently checked branch identities and source facts, including short names, chains, romanization, wrong-branch pages, individual reviews, source conflicts, and provider failure.
- No invented facts or automatic branch choice for genuinely ambiguous inputs.
- Unknown enrichment is reported as incomplete, not counted as success.
- At least one real owner-confirmed Add is visible after refresh and remains duplicate-free on retry. Public readers still cannot write.

Do not mark a pending item complete from a successful HTTP response, a plausible preview, or a model's own success claim.

## Confirmed Add field and display requirements

| Information | Required behavior | Current gap |
| --- | --- | --- |
| Identity and location | Resolve a rough hint to the correct branch; save name, area, address and coordinates; keep coordinates out of the main card | Google discovery and durable geocoding exist; full live acceptance remains pending |
| Food categories and signature dishes | Prominent short keywords on the list card and detail header | `tags` exists, but Add publication currently writes an empty array; research and preview need wiring |
| One-sentence description | Source-grounded summary of cuisine or signature dishes, replacing boilerplate | `description` exists; Add currently writes a generic intake message |
| Ratings | Japan: Tabelog primary, Google optional. Other countries: Google preferred. Mainland China: no external rating required. Personal score remains separate | Tabelog and personal scores exist; Google rating schema and aligned UI presentation remain pending |
| Reservation rules | Prefer verified official branch/booking sources, use Tabelog as fallback; include explicit lead time, release schedule and booking method when available | Existing optional fields: `advanceDays`, `bookingWindowLabel`, `releaseNote`, `channel`; automated population and live evidence still incomplete |
| Links | Show official site, Tabelog, and applicable map/booking links | `officialUrl` and `sources` exist; research-to-Add propagation must be completed |
| Personal controls | Preserve favorite, visited, edit, personal notes, and visit records independently from external facts | Existing controls must be regression-tested as Add expands |
| Confirmation and visibility | Show a concise preview; only owner confirmation writes; successful map-ready records appear after refresh | Do not label `committed_needs_review` as visible-map success |

## Agent API integration boundary

Existing POST endpoints: `/api/catalog-intake/discover`, `/select`, `/confirm`, and `/cancel` under the same prefix. The public capabilities document exposes their required input fields. A caller needs an authenticated owner session and same-origin request headers; after discovery it must echo `x-atlas-web-conversation-id`. Model API keys do not authorize application writes.

The in-repository research agent can return evidence through `WebResearchPort`; it cannot directly write arbitrary JSON to D1. External agents do not yet have a dedicated token-authenticated structured-proposal API. That adapter, expanded proposal schema, field provenance, and confirm-version binding are pending work. Reuse the existing application validation/publication services rather than creating a second write implementation. Do not pass inferred values off as `ownerFields` or owner-asserted ratings.
