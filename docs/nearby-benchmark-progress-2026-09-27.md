# Nearby benchmark progress — 2026-09-27

## Dataset and evidence

| Slice | Cases | Evidence | What it can assess |
| --- | ---: | --- | --- |
| Policy seed (`evals/nearby/nearby-gold.v1.json`) | 14 | Fixed fictional saved catalog and synthetic tool observations | Saved-only selection, route boundaries, clarification, visited preference and uncertainty labels |
| Location seed (`evals/nearby/nearby-location-gold.v1.json`) | 10 | [Tokyo Metro Ikebukuro](https://www.tokyometro.jp/station/ikebukuro/index.html), [Higashi-ikebukuro](https://www.tokyometro.jp/station/higashi-ikebukuro/index.html), [Shinjuku-sanchome](https://www.tokyometro.jp/station/shinjuku-sanchome/index.html) and [Shinjuku-gyoemmae](https://www.tokyometro.jp/station/shinjuku-gyoemmae/index.html) station pages and their English versions, checked 2026-09-27 | Station identity, multilingual wording, cuisine/visited intent and two explicit two-station ambiguities |

The official pages establish station names and line codes. They do not establish
travel durations, restaurant availability or booking facts. The policy route
values are deliberately fictional, so they cannot be cited as Tokyo route
evidence. No personal saved catalog or history is included in either dataset.

## Scorer checks

The policy scorer reports action accuracy, selection accuracy, uncertainty
coverage, safety violation cases and optional latency, tool-call and cost
telemetry separately. The location scorer reports action accuracy and full-case
pass rate, failing invented stations, unsupported route/recommendation claims,
wrong constraints and premature resolution of ambiguity. Both scorers reject
missing or duplicate case predictions. Their tests use gold-derived oracles
only to prove the scoring contracts are satisfiable.

All scorer tests, the full local test suite, lint, typecheck and the owner PoC
build passed. **No actual Nearby model predictions have been scored.** This is
dataset construction, not model quality or release acceptance.

## Proposed gates before model acceptance

- Zero recommendations outside the saved catalog and zero invented station,
  route-duration or booking claims.
- All ambiguity and provider-failure safety cases pass.
- Select action/selection thresholds after expanding and reviewing the
  independently verified dataset, before running the model. Report those
  metrics and latency, tool calls, provider coverage and cost separately.

Next, add independently checked neighborhoods and station aliases, dated real
route/source observations in a separate live suite, and representative saved
catalog fixtures. Then run the configured model without exposing gold answers.
