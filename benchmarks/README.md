# Benchmarks

Offline regression checks and opt-in live evaluations for Place Atlas. Application code lives in `apps/web`; these suites import its production functions where appropriate. Results, credentials and deployment-specific catalog bindings are private local evidence, not repository documentation.

## Run

Use Node.js 22.13+ and install the application dependencies with `npm ci --prefix apps/web`. From the repository root:

```sh
npm run benchmark
npm run benchmark:add
npm run benchmark:place-resolution
npm run benchmark:place-enrichment
```

`benchmark` runs every offline suite. The two scorer commands use example predictions to verify the scoring contract, not a model's quality. Resolution and enrichment generate scorer examples from gold rather than storing duplicate answer files. `npm test --prefix apps/web` runs application tests followed by all benchmarks; CI uses the same command.

| Suite               | What it measures                                                                                     | Evidence and gate                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `add-behavior/`     | Branch identity, sourced profile facts, booking destinations, hours, duplicates and preview behavior | Controlled inputs against production readers/research/presentation; every test must pass            |
| `place-resolution/` | Resolve, clarify or no-match; branch identity and top-three recall                                   | Independently curated gold, portable input/output schemas and deterministic scorer                  |
| `place-enrichment/` | Supported field extraction, missing facts, provenance and rating completion                          | Frozen evidence and independent field expectations; scorer and parser controls                      |
| `nearby/`           | Origin interpretation, cuisine/visit constraints and verified route limits                           | Controlled catalog and provider observations; rejects invented identities and travel times          |
| `recommend/`        | Intent, dialogue continuation, decision and UI/API contract                                          | Distinct intent, decision and journey fixtures; separate production harness and model-only baseline |

A passing offline test proves only its controlled behavior. A live model run additionally measures model output and provider availability. A browser/database journey must establish confirmation, persistence and readback separately. Keep these results and case counts separate.

## Dataset and prediction contracts

A case includes input, independent expected behavior, reproducible evidence or source references, and acceptance criteria. Gold answers and scenario labels remain evaluator-side and are never included in model input. Resolution and enrichment provide JSON Schemas and scorer examples; other scorers validate their own case/output shape. Missing cases are failures rather than silently reduced coverage.

Resolution reports action/identity accuracy, target recall, clarification and no-match accuracy, plus unsafe auto-resolution. Gold thresholds are explicit in the dataset. Enrichment scores fields and evidence support; an unknown field is appropriate only when evidence is absent or invalid. Recommendation rejects IDs outside the supplied saved catalog and travel claims unsupported by route observations.

The datasets are small regression sets, not a worldwide leaderboard. Public source facts can change; record observation dates and review stale cases independently. Controlled examples cannot establish current ratings, booking availability or operating hours.

## Live runs

Live runs are opt-in and can incur provider usage. Use an authorized test deployment and keep results under ignored `benchmarks/runs/`. Run from the repository root; supply credentials through the process environment or an ignored environment file. Never commit keys, cookies, saved item IDs, catalog captures or raw responses.

| Runner                                    | Required configuration                                                                                         | Scope                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `place-resolution/run-live-discovery.mjs` | `ALLOW_ADD_LIVE_EVAL=yes`, `ATLAS_BASE_URL`, `OWNER_TEST_PASSWORD`                                             | Discover, independently score identity, cancel transient sessions; no publication         |
| `place-enrichment/run-live-rating.mjs`    | Same deployment configuration                                                                                  | Discover/select/research and cancel; rating evidence only, no publication                 |
| `add-behavior/run-browser-add.mjs`        | Local `ATLAS_BASE_URL`, installed Playwright or `PLAYWRIGHT_MODULE`                                            | Controlled current UI across desktop/mobile; every API request is intercepted             |
| `add-behavior/run-live-add.mjs`           | `ATLAS_ADD_AGENT_URL` for `/api/agent/catalog-intake`, `ATLAS_ADD_AGENT_TOKEN` or `ATLAS_ADD_AGENT_TOKEN_FILE` | Discover/select and check independently specified facts, then cancel; never confirm       |
| `run-add-enrichment.mjs`                  | `AGENT_API_KEY`, `AGENT_BASE_URL`, `AGENT_MODEL`                                                               | Experimental frozen-evidence extraction prompt; distinct from production Add              |
| `recommend/run-live-intent-harness.mjs`   | Model configuration above                                                                                      | Production intent interpreter against fixed cases                                         |
| `recommend/run-deepseek-baseline.mjs`     | `AGENT_API_KEY`, `AGENT_MODEL`                                                                                 | Separate model-only prompts; not application acceptance                                   |
| `recommend/serve-browser-acceptance.mjs`  | `ATLAS_BASE_URL`, optional `ATLAS_OWNER_COOKIE_FILE`, trace path                                               | Serve test UI and record real HTTP conversations; controlled outages replace dependencies |

For example:

```sh
node --experimental-strip-types --env-file=apps/web/.env \
  benchmarks/run-add-enrichment.mjs benchmarks/runs/extraction.json
node --experimental-strip-types --env-file=apps/web/.env \
  benchmarks/recommend/run-live-intent-harness.mjs benchmarks/runs/intent
```

Use a new output path for each run. Some runners accept one case ID or an environment case selector; report partial coverage explicitly. Provider failures remain failed observations, with latency and token usage when available. After a deployed run, verify transient sessions are canceled and saved records are unchanged.

For browser acceptance, independently prepare `contract-bindings.json` alongside the ignored capture's `catalog.json` and `browser-observations.json`. It maps each gold case ID to a scenario and optional source URL/query/answers for your test catalog. `materializeContract` rejects missing bindings and nonunique identities; expected items come from this independently prepared binding, never from the agent's selected result. Score with `recommend/score-captured-contract.mjs <capture-directory>`.

## Add or update a case

1. Identify a general behavior and its failure boundary. Prefer a small synthetic fixture and include a nearby negative control.
2. Define the input, independent expected outcome and observable acceptance criteria before running the model. Preserve multilingual wording where it is the behavior under test.
3. For live Japanese restaurant facts use the exact Tabelog main listing; elsewhere use the selected Google Maps place. Record the source and observation date. Keep Owner-specific research private.
4. Extend the existing suite and run `npm run benchmark`; do not introduce another runner for the same workflow. Keep model-only, production harness and publication checks distinguishable.
5. Remove replaced fixtures, batches and generated results after the work. Explain substantial necessary additions in chat; do not preserve incident narratives in public docs.
