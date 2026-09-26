# Add source-access investigation and developer handoff

Updated: 2026-09-26. **The Tokyo Mentsudan Add journey now passes on Cloudflare.** Source retrieval, real DeepSeek enrichment, confirmation, duplicate-safe replay and refreshed browser display were checked. This is a limited live acceptance case, not a complete benchmark result.

## Goal and non-negotiable boundaries

Keep the website, repository-owned Agent workflow, D1 and R2 on Cloudflare. Do not migrate to AWS or GitHub Pages. Do not introduce a required messaging platform. Do not recreate root-level planning frameworks or use Harness Flow.

The owner supplies a rough restaurant hint. The application resolves the exact branch, researches its profile, shows a useful preview, and persists it only after owner confirmation. The saved restaurant must immediately appear in the list and map and survive a refresh. Users should not have to type facts that a source already supplies.

For Japanese restaurants, obtain the actual Tabelog aggregate score from the matching restaurant listing. A Google score, a search result's unexplained number, a reviewer score, model memory, or an old fixture is not an acceptable substitute. Google ratings are optional for Japan. The profile also needs name, area, address, coordinates, cuisine, a grounded description/specialties, official links when available, and supported reservation information. Unknown booking lead time is preferable to an invented rule, but an entirely unknown preview is not product success.

## Read these files first

1. Root `README.md`: setup, owner authentication, model configuration and deployment. Owner model settings stored in D1 can override deployment model configuration.
2. `docs/status.md`: implemented features versus outstanding live acceptance. Add is the immediate priority; Nearby and Record are separate unfinished journeys.
3. `docs/architecture.md`: application/tool/model boundaries.
4. This document: source-access attempts and next steps.
5. `docs/add-evaluation-2026-09-26.md` and `apps/web/evals/place-enrichment/README.md`: distinguish frozen-evidence extraction from live retrieval and persistence.

`apps/web/product` and `apps/web/features` contain executable business/UI code. They are not the removed root-level planning directories; do not delete them as documentation cleanup.

## What currently works, and what does not

- The Cloudflare deployment can authenticate the owner, test/save encrypted model settings, call DeepSeek, and discover Google branch candidates.
- Production research uses a bounded model/search loop. Yahoo Japan supplies no-key Japanese search; DuckDuckGo is used for other queries. These are best-effort public search paths, not guaranteed APIs.
- A deterministic Tabelog parser extracts the exact Restaurant JSON-LD aggregate rating and branch identity, plus location, cuisine, reservation-table facts and official links when present. It excludes individual reviews.
- A Cloudflare-native Browser Run adapter is wired into discovery and research as a fallback after failed ordinary reads. It needs no additional server or browser API credential.
- Confirm, deduplication, structured profile propagation and public DTO/card paths exist and have local tests. This does **not** prove the deployed user journey works.
- The deployment now selects `RESTAURANT_SOURCE_READER=firecrawl`. Firecrawl's documented anonymous scrape endpoint returned real listing HTML from Cloudflare for Tokyo Mentsudan (3.54) and Yotsuya Takeda (3.71), approximately four seconds each. These are observed scores, not permanent gold values.
- Actual Chromium Add with the deployed DeepSeek model produced complete Tokyo Mentsudan previews twice: name, area, address, coordinates, categories, dishes, aggregate score, official site and reservation policy, with no manual field completion.
- The first confirm exposed a separate bug: a prior owner-only review candidate matched the strong identity, so the publisher returned `reused_existing` without making it public. Read-only D1 inspection confirmed that the returned ID existed only in `atlas_review_candidates`. The publisher now promotes a matching candidate when the newly confirmed preview is complete, retains its ID and original identity audit, updates source snapshots atomically, and removes the candidate only after a verified publication receipt. Existing public items remain unchanged. Tests cover promotion, replay and a catalog-revision race.
- After that repair, confirmation returned `committed_verified` but the public catalog still omitted the row. The older catalog validator rejected three newer, valid intake shapes: `profile`, `agent_observed` location evidence, and `not_reservable` reservation evidence. Validation now accepts and checks these shapes rather than dropping researched records. Earlier profile tests projected a DTO directly and missed the actual catalog-read filter; the regression now goes through D1 and `catalog.list('verified_catalog')`, and still rejects malformed unsourced profiles. No database rewrite is needed for this read-side repair.
- Final live result: restaurant ID `01ee9b01-2ac9-4802-b16c-6adcec6e3f33` is public and appears in the refreshed list/detail/map. Catalog count changed from 41 to 42, with exactly one matching ID. Tabelog 3.54, coordinates, categories/dishes, official link and reservation policy survived persistence; repeated confirmation returned the same receipt with `replayed: true`. The browser had no page errors. The confirmation-phase research produced a refreshed preview; it was explicitly reviewed and confirmed again, not silently accepted.
- Deployed Worker version for this acceptance: `e5f842ae-5aba-4b1f-8e84-2e4889a09370`. No extra hosting instance, paid-reader subscription or database migration was introduced.
- Independent external-Agent authentication is not yet a completed feature. Existing intake HTTP endpoints use owner-session authentication and conversation binding; do not describe them as an anonymous or general bearer-token Agent API.

## Investigation results

Primary test listing: `https://tabelog.com/tokyo/A1304/A130401/13004352/` (Tokyo Mentsudan). Second listing: `https://tabelog.com/tokyo/A1309/A130902/13131643/` (Yotsuya Takeda).

| Method / environment | Observation | Conclusion |
| --- | --- | --- |
| Ordinary GET, development host | Correct listing returned HTTP 200 | Local access is possible; not evidence of Worker access |
| Ordinary GET, Cloudflare Worker | HTTP 403 with Tabelog high-traffic page | Production source access fails |
| Language and application User-Agent variations | No improvement in the earlier Worker comparison | Do not keep changing headers without a specific hypothesis |
| English listing, ordinary Worker fetch | HTTP 403 in the earlier comparison | Language variant was not a remedy |
| Cloudflare Browser Run REST, invoked from development host | Tokyo Mentsudan read successfully twice; structured aggregate, address and coordinates were parsed | Positive isolated transport checks only |
| Native Browser Run binding in a Worker | One successful Takeda page read; Mentsudan returned a challenge | Unstable; not a reliable fallback yet |
| Browser Run REST invoked inside a Worker | API success, but returned challenge HTML | Replacing the binding with REST is not a proven solution; never store the broad Wrangler OAuth token in the app |
| Deployed Add with the browser adapter | Both named test restaurants still lacked useful researched location/rating | End-to-end acceptance failed |
| Tabelog mobile URL | Development host redirected to the canonical listing; Worker returned HTTP 403 | Not an independent usable source |
| Tabelog map subpage (`dtlmap/`) | Development host returned a real page; Worker returned HTTP 403 | Another public page does not solve the observed network difference |
| Cloudflare Kitesurf engine, native Worker binding | Browser API HTTP 200, but high-traffic HTML with no parsed restaurant facts | Alternative engine failed this probe |
| Jina Reader, no key, HTML output | Development-host request returned HTTP 200 containing `Just a moment...`; Worker request returned HTTP 429 | Not integrated; no usable rating obtained |
| Microlink, no key, documented HTML output | Worker request returned HTTP 429 | Not integrated; source readability was not established |
| Firecrawl v2 scrape, no key, `rawHtml`, fresh read, basic proxy | Development host and Cloudflare returned the real matching listing; both control restaurants parsed successfully | Integrated through `RestaurantSourceReader`; no app/database migration or extra server |
| Deployed Add with Firecrawl and real DeepSeek | Complete Tokyo Mentsudan preview in two independent browser sessions | Source access and enrichment passed this smoke; first confirm exposed a separate hidden-candidate persistence defect |

These are bounded observations, not universal claims that a provider always fails. In particular, a reader-service 429 does not establish whether its authenticated service can read Tabelog. No paid-reader account or credential was configured. Do not retry 429 responses aggressively or claim that buying a key will guarantee success.

The exact Tabelog detection rule is **unknown**. Environment-dependent results are established; a universal Cloudflare ban, a specific IP rule, or a model/prompt defect is not. Browser API HTTP 200 only describes that API call: the returned document may still be a challenge. Existing Google/DeepSeek keys cannot authorize a separate reader service or change Tabelog's access decision.

Public sources reviewed:

- [Tabelog scraper maintainer's network-access report](https://apify.com/jpopendata/japan-restaurants-tabelog): corroborating third-party experience, not Tabelog's official explanation or an independently tested product endorsement.
- [Cloudflare browser request identifiers](https://developers.cloudflare.com/browser-run/reference/automatic-request-headers/): Browser Run remains identifiable as automation.
- [Cloudflare Kitesurf capabilities and limitations](https://developers.cloudflare.com/browser-run/kitesurf/): not a guarantee of site compatibility.
- [Jina Reader documentation](https://github.com/jina-ai/reader): tested HTML mode with zero cache tolerance; no valid listing resulted.
- [Microlink HTML endpoint](https://microlink.io/html): tested the documented anonymous endpoint; received 429.
- [Firecrawl introduction](https://docs.firecrawl.dev/introduction): currently documents no-account/no-key initial calls and an optional key for higher limits. Anonymous access is a PoC trial, not a long-term availability or unlimited-free guarantee.
- [Firecrawl scrape API](https://docs.firecrawl.dev/api-reference/endpoint/scrape): raw HTML, freshness and source metadata options. The adapter requests `maxAge: 0`, `proxy: "basic"`, and validates both final URL and requested source URL against the exact listing.
- [Browser-local Tabelog extension design](https://gist.github.com/0xkuchida/1f5718764a338e67000cf12f38dcc4fe): illustrates a user-browser approach, but adding an extension changes the required user experience and has not been implemented or validated here.

## Code navigation: follow the actual request

| Responsibility | Entry points under `apps/web/` |
| --- | --- |
| Add UI and request payloads | `features/atlas/catalog-intake-panel.tsx`, `features/atlas/use-catalog-intake.ts`, `features/atlas/catalog-intake-ui-state.ts` |
| Owner-authenticated HTTP operations | `app/api/catalog-intake/{discover,select,confirm,cancel}/route.ts`, `app/api/catalog-intake/catalog-intake-response.ts` |
| Runtime composition and configuration | `lib/server/application/owner-poc-composition.ts`, `lib/server/application/catalog-intake-provider-mode-manifest.ts` |
| Discovery and durable geocoding | `adapters/providers/tabelog-place-discovery.ts`, `adapters/providers/nominatim-durable-geocoder.ts`; Google discovery is selected when configured |
| Production model loop | `agent/place-research.ts` |
| Production instructions and listing URL allowlist | `agent/research-instructions.ts` |
| Search transport | `agent/web-search.ts` |
| Fixed-source HTTP reader and deterministic parser | `agent/tabelog-listing.ts` |
| Native browser adapter / source-reader seam | `agent/browser-source-reader.ts`: `RestaurantSourceReader`, `createRestaurantSourceReader`, `createBrowserRestaurantReader` |
| Current deployed listing transport | `agent/firecrawl-source-reader.ts`; optional server-only `FIRECRAWL_API_KEY`, selected by `RESTAURANT_SOURCE_READER=firecrawl` |
| Atomic publication and candidate promotion | `lib/server/application/d1-atlas-catalog-intake.ts` and its SQLite contract tests |
| Catalog visibility / runtime schema validation | `product/application/catalog/catalog-projection.ts`, `catalog-read.ts`; test the actual read path, not only direct DTO projection |
| Preview, evidence validation, confirmation and persistence coordination | `product/application/catalog-intake/catalog-intake-coordinator.ts`; follow its injected stores/write ports into `adapters/` |

The production loop currently allows two searches and three model turns within a 35-second research deadline. Firecrawl is selected directly, not stacked behind multiple failing readers: 15-second provider timeout, 20-second client cap combined with the parent signal, two-MiB response cap, no retries. Ordinary page reads have a five-second timeout; the alternative browser reader has a twelve-second navigation timeout. Account for this shared budget before adding another serial fallback. A browser binding call is not automatically cancelled by the application's AbortSignal; late results are discarded, but the browser operation can still consume its own bounded execution time.

The model can call `search_web`; the application augments results with a fixed-source listing read. The model does not currently have a general full-page official-site reader. Do not tell users that a generic browsing Agent already exists.

## Next implementation steps

1. **Verify the deployed journey, not merely a preview.** Research -> preview -> owner confirmation -> returned item ID -> catalog read -> list/map after refresh -> retry without duplicates. The discovered candidate-promotion defect demonstrates why this matters. Never repair it by inserting rows directly or deleting old confirmation receipts.
2. **Expand live acceptance against the existing gold sets.** Include short names, romanization, ambiguous chains, wrong-branch distractors, no match and inaccessible sources. Run the actual production resolution/research workflow, not only the separate frozen-evidence prompt. Do not feed gold answers to the model. Recheck volatile ratings in the same time window.
3. **Treat reader quota as an operational dependency.** No Firecrawl key is currently configured. If anonymous reads become unavailable, report the reader-service failure honestly and configure a dedicated server-side key only with the owner's approval. A model key does not authorize a reader service. Do not promise an unlimited free service or keep retrying 429s.
4. **Improve research coverage independently from transport.** General official-site reading and automated booking lead-time extraction remain unfinished. Trace model output through `validateWebResearchOutput` and profile validation; distinguish missing source evidence from extraction or schema rejection. Do not weaken branch/quote checks or invent booking difficulty.
5. **Keep the architecture decoupled.** Extend `RestaurantSourceReader` and repository-owned tools, not the UI or an external chat platform. Restrict targets, validate final URLs, bound deadlines/body size/retries, and preserve source/freshness. Owner/model secrets must never reach source pages.
6. **Follow the product checklist after Add.** Build/evaluate the Nearby Agent benchmark before connecting it; finish deterministic Record card/Journal/photo integration. Do not mark those journeys complete based on Add success.

If the current reader becomes unavailable and alternatives fail, discuss an explicitly owner-triggered browser import or a licensed data source with the user. Those are product/provider choices, not silent substitutes for automatic server-side Add. Do not force manual rating entry while claiming the original requirement is complete.

## API testing details

Log in through `/api/auth/owner` using the current password supplied securely. Preserve the owner session cookies, send the same-origin `Origin` header for writes, and retain `x-atlas-web-conversation-id` from discovery for later intake calls. Never log passwords, cookies, API keys or authorization headers.

All four intake endpoints expect `{ "input": { ... } }`:

- Discover: `query`, fresh `requestToken`.
- Select: returned `sessionId`, `expectedSessionVersion`, candidate `ordinal`, `ownerFields`, `tabelog: "unknown"`, `reservation: "unknown"`, `requestResearch: true`.
- Confirm: `sessionId`, `expectedPreviewVersion` from the actual preview. Inspect the returned status, not only HTTP status.
- Cancel: `sessionId`, latest `expectedSessionVersion` (not the preview version). Omitting the version causes a 400 response.

Use the current TypeScript interfaces as the source of truth. For read-only diagnostic previews, cancel the session rather than confirming an incomplete restaurant. Do not bypass the workflow with direct D1 inserts.

## Verification and deployment

From `apps/web`, run:

```sh
npm run typecheck
npm run lint
node --experimental-strip-types --test \
  agent/firecrawl-source-reader.test.mjs \
  agent/browser-source-reader.test.mjs \
  agent/tabelog-listing.test.mjs \
  agent/place-research.test.mjs \
  adapters/providers/tabelog-place-discovery.test.mjs \
  lib/server/application/catalog-intake-provider-mode-manifest.test.mjs \
  lib/server/application/d1-atlas-catalog-intake.sqlite.contract.test.mjs \
  lib/server/application/owner-poc-catalog-intake-composition.sqlite.contract.test.mjs \
  product/application/catalog/catalog-read.test.mjs \
  product/application/catalog/catalog-write.test.mjs \
  lib/server/public-read/public-read-manifest.test.mjs \
  scripts/owner-poc-deployment-preflight.test.mjs
```

The combined source-reader, publication, catalog/public-boundary, composition and deployment slice passed **90 tests**, plus typecheck and lint. This includes HTTP-200 challenge handling, Firecrawl safety, candidate promotion/replay, revision-race protection and sourced-profile visibility. Build, deployment preflight and strict deployment passed. The previous full-suite attempt did not finish and is not a passing result. Run broader affected tests after actual data-path changes.

- Resolution gold: `evals/place-resolution/place-resolution-gold.v1.json`.
- Complete-profile frozen evidence: `evals/place-enrichment/place-enrichment-gold.v1.json`.
- Live-rating protocol/control set: `evals/place-enrichment/rating-completion-benchmark.v1.json` and its README/scorer.
- `agent/live-smoke.mjs` exercises the production research adapter on the development host, not Cloudflare and not the entire Add flow.
- `evals/run-add-enrichment.mjs` uses a separate frozen-evidence evaluation prompt. Its successful 130/130 field-state result is not live retrieval acceptance.

Keep raw runs under ignored `evals/runs/`; retain only curated datasets, regressions and concise reports in Git. Recheck volatile scores independently in the same evaluation window. Do not feed gold answers to the production Agent.

The deploy target remains `https://japan-atlas-owner-poc.japan-atlas-poc.workers.dev/`. Use the existing ignored `wrangler.owner-poc.local.jsonc` and `npm run deploy:owner-poc`, which builds, checks deployment preflight and performs a strict deploy. Preserve database IDs, data, secret settings and existing service bindings. No source-reader change requires clearing the database. Keep local credentials and database exports out of Git.

The worktree contains an unrelated untracked `apps/web/scripts/migration-packaging.ts.orig`; leave it untouched. Check current Git/deployment state before starting, rather than assuming this document's date implies a particular deployed revision.
