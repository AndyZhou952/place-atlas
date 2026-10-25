# Benchmark

One runner, one case file:

- **Add** (`cases.json → add`): search → pick the first candidate → preview. Checks that the right restaurant is found and that its Tabelog score, location, prefecture, cuisine, hours and reservation policy were extracted.
- **Recommend** (`cases.json → recommend`): a small fictional catalog and requests in Japanese and English. Checks the first pick, required and excluded restaurants, and whether a starting point was geocoded.

```sh
cd apps/web
npm run benchmark                      # offline: stubbed sources and model, shows the report format
AGENT_API_KEY=… AGENT_BASE_URL=https://api.deepseek.com AGENT_MODEL=deepseek-flash \
FIRECRAWL_API_KEY=… npm run benchmark -- --live
npm run benchmark -- --live --json ../../benchmarks/runs/2026-10-25.json
```

Each line of the report is one check: `PASS|FAIL  suite  case  check  observed value`, followed by a pass count per suite.

Offline mode only proves the runner and scoring work; unit tests in `apps/web/test` cover the pipeline logic. Live mode measures real search, Tabelog availability and model quality, all of which change over time; keep live results in the ignored `benchmarks/runs/` directory, not in the repository.

To add a case, append an entry to `cases.json` with only the checks that should hold for that restaurant or request. Prefer structural expectations (has a score, correct prefecture) over values that change, such as exact ratings.
