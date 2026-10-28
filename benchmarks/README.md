# Benchmark

One runner, one case file, both driving the production harness:

- **Add** (`cases.json → add`, live only): discover → select the first match with agent research → check the preview: the right restaurant, prefecture, coordinates, Tabelog score, opening hours, cuisine and reservation rule.
- **Recommend** (`cases.json → recommend`): a small fictional catalog and requests in Japanese and English. Checks the answer type (recommend or clarify), the first pick, and required and excluded restaurants.

```sh
cd apps/web
npm run benchmark                      # offline: Recommend with recorded model interpretations
AGENT_API_KEY=… AGENT_BASE_URL=https://api.deepseek.com AGENT_MODEL=deepseek-flash \
GOOGLE_PLACES_API_KEY=… CATALOG_INTAKE_GOOGLE_PLACES_MODE=enabled \
RESTAURANT_SOURCE_READER=firecrawl FIRECRAWL_API_KEY=… npm run benchmark -- --live
npm run benchmark -- --live --json ../../benchmarks/runs/2026-10-25.json
```

Each line of the report is one check: `PASS|FAIL  suite  case  check  observed value`, followed by a pass count per suite. Each Add attempt also reports the listing research accepted, which provider stage (search, listing read, branch match, timeout) left it incomplete, and each failed provider call with the provider's HTTP status, the source page's status and the result class (no URLs or queries); a failed research-backed check names that stage, and the JSON marks each failure `provider` (a refused or failed search, read or timeout) or `behavior` (the harness's own result, including a listing it rejected as another branch). The deterministic identity, search-recovery and reservation-meaning rules are covered offline by `npm test`.

Offline, each Recommend case's `interpretation` stands in for the model and `places` stands in for geocoding, so the run checks the deterministic rules that turn an interpretation into recommendations. Live mode measures the real model, search, Tabelog, Google and Nominatim, all of which change over time; set `GOOGLE_MAPS_API_KEY` to include route checks. Keep live results in the ignored `benchmarks/runs/` directory, not in the repository.

To add a case, append an entry to `cases.json` with only the checks that should hold for that restaurant or request. Prefer structural expectations (has a score, correct prefecture) over values that change, such as exact ratings.
