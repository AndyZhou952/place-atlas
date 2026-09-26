# Selected chain branch enrichment regression

Date: 2026-09-26. Example: Torikizoku Shinjuku South Exit, after the user
selected the Google candidate. This is not unresolved chain-name ambiguity.

## Reproduced failure

The deployed select endpoint returned unknown address, coordinates, rating and
reservation. A local trace using the real configured DeepSeek model reproduced
the same result. Search contained the correct main listing, but the application
read only its first result, a different localized listing that could not be
parsed. The model then finished from snippets without requesting another read.
Additionally, the branch matcher rejected the three-character Japanese alias
in the owner's query when the selected provider name was English.

## Fix

- Rank search evidence using selected name/address corroboration, not search
  order alone. Read another discovered listing after a failed or wrong-branch
  read, with a maximum of three distinct page reads across the existing two
  searches and 35-second research deadline.
- Normalize recognized localized main-listing URLs to the canonical Japanese
  listing; never widen reads to arbitrary hosts or review-detail pages.
- Accept three-character CJK name clues only alongside the existing street
  number and locality corroboration. Names alone never establish a branch.
- For parsed listings, verify locality in the address field, not in a restaurant
  name containing a city/ward. A synthetic same-name/wrong-city case caught
  and prevented this false positive.

## Evidence and acceptance

Curated dataset: `apps/web/evals/place-enrichment/selected-chain-regressions.v1.json`.
Six controls cover second-result ranking, failed-first-read recovery,
wrong-first-branch recovery, localized URLs, wrong streets and wrong cities.
The production research implementation is exercised with controlled tools.
The 36 research/reader/search tests passed after the change.

Real DeepSeek with live search/source reading returned the South Exit listing's
address, coordinates, three cuisine categories, reservable status and aggregate
Tabelog score 3.07. After deployment, the real website discovery/select API
was retested against that selected branch and returned all those fields with
`unknownFields: []`; the session was cancelled without confirming. The dated source is
<https://tabelog.com/tokyo/A1304/A130401/13138401/>; branch address is independently
corroborated by <https://map.torikizoku.co.jp/detail/288/>. No restaurant was
saved by these diagnostics. The live score is an observation, not a permanent
benchmark constant or a guarantee that every branch has a published score.

Distinct issue: browser diagnostic processes crashed before completing the
query. They did verify Map/Journal-only navigation and the retired Review API's
404 response. The Add failure above was then reproduced through the exact
website API, rather than treating the browser process crash as an application
failure. The full browser interaction is not claimed as passing in this run.
