# T-02 Review UI render evidence

- Build: production `vinext build`, served locally with `vinext start`
- Harness: `apps/web/scripts/t02-review-browser-smoke.mjs`
- Render contract: loading, signed-out, error, empty, and list states
- Retired UI assertions: no `Queue a creator`, `New creator import`, `Collector status`, or `Import jobs`

| Viewport | Screenshot | SHA-256 | Page width | Workspace width |
|---|---|---|---:|---:|
| 1440×1000 · signed-out | `t02-review-desktop-signed-out.png` | `1db1917c4d7f03138c0503e7be64f2616cbf2dbafca397cc2e59e9ad748b1ce2` | 1440 / 1440 | 1440 / 1440 |
| 1440×1000 · list | `t02-review-desktop-list.png` | `2e6462d3abe0a4cb92dcfe1b989ea6a8435785cb9cefc38b0d907859fbb87005` | 1440 / 1440 | 1440 / 1440 |
| 390×844 · signed-out | `t02-review-mobile-signed-out.png` | `c22a1f8ba97ebaaec513fca3afad950a948e4bc76eca4eb1c57f26d622671e5d` | 390 / 390 | 390 / 390 |
| 390×844 · list | `t02-review-mobile-list.png` | `84ca2958908f7e184c74cb5f98898427adf87e6e4a1ad556ae14d52c73d54bac` | 390 / 390 | 390 / 390 |

Each width is `scrollWidth / clientWidth`; no state has horizontal overflow. The browser contract also asserts the loading live status and `aria-busy`, signed-out Owner-login CTA, error alert and retry CTA, empty Add CTA, and list evidence disclosure. At 390px the three primary CTAs measure 44px high (and more than 44px wide); all buttons have accessible names and every state retains a heading.

The executable vertical gate is `apps/web/scripts/t08-review-vertical-smoke.mjs`. It first runs Catalog Intake against migrated SQLite/D1 until a real `committed_needs_review` is persisted, then the real Owner Review HTTP route emits the closed DTO. That exact generated file is passed to the production browser client, ViewModel and React UI; both desktop and 390px renders assert the persisted `data-review-candidate-id` (`verified-2`). The generated route bytes for this run were SHA-256 `8defa9d61b6b0b20e0505db480d926ab6070498967c52d38840d0639cb90f056`. The same fixture gate asserts verified-catalog/Public Map/Nearby projections exclude the candidate. The five-state network harness remains supplemental state coverage; its list state uses the generated route DTO whenever `T02_PERSISTED_ROUTE_FIXTURE` is set and never hand-authors that vertical-gate candidate.

## T-09 persisted vertical evidence

The same successful wrapper run produced a machine-readable report and separate persisted screenshots; these filenames are never used by fallback-only runs.

| Artifact | SHA-256 |
|---|---|
| `t09-review-persisted-report.json` | `5e08ef98d1786a6fa9d8996c3179d8350bdc718d213595ab1fc2527bfb4f76bc` |
| `t09-review-persisted-desktop-list.png` | `03d59ee32b843384657749db3614b09ece89d0a71995a112c7e8c6790ca46e56` |
| `t09-review-persisted-mobile-list.png` | `caa37fe3b8a96c459be8a8ca4e2118b4498c05b370bf0b4b109e995a1167a29a` |

The report binds candidate ID `verified-2`, route hash, both screenshot hashes, and the public-catalog absence assertion. Before opening Review, the browser consumes the real anonymous Public Read DTO and verifies the candidate title/ID has no public list or marker DOM while verified item `verified-1` and its marker render. The Owner route rejects an anonymous request and accepts the real Owner cookie. Nearby exclusion remains asserted against the same D1 fixture. Mobile semantic checks cover every button, link, and `Evidence details` summary for an accessible name and a minimum 44×44px target, plus duplicate IDs, ARIA references, live status, headings, and horizontal overflow.

Visual inspection of the two persisted list screenshots found no clipping, overflow, hierarchy regression, or design-direction drift; the 390px disclosure and warnings remain legible in the existing warm editorial layout.

Visual inspection confirmed the Review navigation, Owner-login CTA, actionable candidate disclosure, hierarchy, and mobile wrapping remain clear in the existing warm editorial design. T-03 extends this browser seam with a persisted Owner list read-back after the creator runtime is removed.
