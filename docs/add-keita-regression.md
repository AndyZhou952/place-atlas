# Add research regression: TONKATSU KEITA

## Root cause

On 2026-09-26 the website correctly selected Google place
`ChIJxUqannfvGGARNtFvkLHEV9s` for `tonkatsu keita`. This was not a lost
frontend JSON mapping. The model mistranslated `Shōan` in the selected address,
spent its two searches on poor queries, and never read the current Tabelog
listing. Unsupported/malformed evidence was correctly rejected; the misleading
“Preview ready” message made incomplete research look successful.

The current listing is `/tokyo/A1319/A131907/13304076/`; the relocated listing
`/tokyo/A1319/A131907/13241723/` is a plausible distractor. Names alone cannot
establish the selected branch.

## Implemented changes

- Exact selected-provider-name search before model inference, consuming one
  of the existing two searches. Do not invent translations of proper nouns.
- Read a canonical main listing, preserve branch-address and aggregate-rating
  validation, and expose source facts and remaining search budget to the model.
- Explicit top-level evidence contract and parsing of listing introductions.
- Visible research progress/elapsed time; incomplete location gets a retry
  instead of false completion or a demand for manual coordinates.
- Optional area/station/branch refinement retains the name. Changed input
  invalidates stale selections/previews. Multiple candidates require a choice.

## Benchmark and observed result

`apps/web/evals/place-enrichment/selected-place-regressions.v1.json` contains
the incident, independently checked source facts, and six post-selection
controls: English, short, Japanese, typo after selection, wrong street and
same street numbers in another city. The real research implementation consumes
mock tools/model in its regression test. No gold is passed to the model.

```sh
cd apps/web
node --experimental-strip-types --test agent/place-research.test.mjs
```

Production browser research returned the current branch address, coordinates,
category, Tabelog **3.72** and **reservation required** on 2026-09-26. Progress
was visible and confirmation enabled. The session was cancelled without saving.
Scores are dated captures, not permanent live expectations. These controlled
tests do not prove an unselected short name uniquely resolves to this restaurant.

## Remaining gates

- Repeated live reliability and full resolution/enrichment coverage; one smoke
  is not a general success rate.
- Recovery when the first listing is a wrong/relocated branch: rejection is
  tested, but recovery using the remaining search is not guaranteed.
- Follow-up: dish extraction now tolerates Japanese quote typography and
  validates each dish separately. A later live Cloudflare/DeepSeek preview
  returned two sourced dishes and included them with reservation policy in the
  summary. The model had previously produced one punctuation-different dish,
  causing the entire array to be rejected. Synthetic wrong-branch and invented
  dish checks still reject unsupported facts. General menu coverage remains open.
- Independently check official links and booking lead times. Directory links
  or high scores do not alone prove site ownership or booking difficulty.
- Reader quota/outage behavior.

Frontend follow-up: production mobile browser refinement passed for Torikizoku
plus Shinjuku west exit (three candidates), AFURI plus Roppongi (two branches),
and Tokyo Mentsudan plus Shinjuku (one candidate). Verified retained names,
fresh request tokens, stale-result removal and explicit multi-match selection.
Six sessions were cancelled without writes; no page errors were observed.
Typecheck, lint and 48 targeted tests passed. The six manifest controls execute
inside one research test and are not six independent live model successes.

## Design references

Reviewed [AI Agent book PR 1137](https://github.com/bojieli/ai-agent-book/pull/1137),
especially `eval-dataset-design` and `loop-engineering`: turn production failures
into regression tasks, verify both actual state and user-visible outcome, and
use independent evidence with bounded retries. Applied these principles to the
existing research loop without adding a workflow framework.
