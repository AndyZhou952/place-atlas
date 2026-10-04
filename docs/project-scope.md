# Place Atlas: scope and release boundaries

Updated 2026-10-04 against the published [0.1.0 release](https://github.com/AndyZhou952/place-atlas/releases/tag/0.1.0), its source tag and the current development branch.

Place Atlas is a self-hosted collection of restaurants, architecture and events across regions. Japan is the location of the current restaurant collection and the strongest research validation, rather than a limit on the product. The website is the implemented user interface. The application owns evidence validation and confirmed writes, independently of the model provider or a future conversational client.

## Released in 0.1.0

| Capability              | Released behavior                                                                                                        | Boundary                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Catalog                 | Stored `food`, `architecture` and `event` records, locations, descriptions and source links                              | Architecture/events are browsable; their automatic Add research lacks equivalent validation |
| Views                   | Map, Table and Journal; name search, detailed records, cuisine/geography filters and sorting                             | Journal and Recommend focus on restaurants                                                  |
| Add                     | Exact restaurant selection, sourced research, editable review and Owner-confirmed publication                            | Source failures remain unknown; international validation is limited                         |
| Record                  | Restaurant Visits, dates, notes, ordered photos/videos, captions and restaurant-level assessments                        | Uploading an image does not automatically interpret its contents                            |
| Recommend               | Verified saved restaurants, clarification, origin choices, straight-line distance and evidence-backed walking on request | Driving and image-based origin recognition are absent                                       |
| Ratings                 | Independent personal, Tabelog and eligible Google scores; initial and explicit per-restaurant private Google references  | Refresh does not replace a saved reference; bulk reference replacement is absent            |
| Deployment              | Cloudflare Workers, D1 and R2; one Owner and model configuration per independent deployment                              | Visitors can read published content; there are no shared-instance user accounts             |
| Integration foundations | Authenticated external Add operations and browser tools over the existing application                                    | No packaged framework integration or messaging bot is included                              |

The external Add route is `POST /api/agent/catalog-intake`. With a configured dedicated Bearer token, it permits discover, select, confirm and cancel through the same coordinator as the website. It is a limited application boundary, not a general remote MCP server, complete chat workflow or machine API for every Visit/media action. Current token/conversation behavior also needs extension before multiple independently paired chat users or rooms can be supported.

## Implemented after the release tag

The restaurant-link and schedule branch and the recorded Owner deployment contain additional improvements. These have not been retroactively added to the 0.1.0 source tag:

- Separate Tabelog listing, reservation-policy citation, official website and alternative booking destination. Plain reservation labels and duplicate-link suppression are shared by Map and Table.
- Collect and preserve sourced hours and regular closing policies: exact Tabelog listing in Japan, selected Google Maps place elsewhere. Missing fields display Unavailable; separate calendar notes do not become weekly rest days.
- Benchmark and repair all 56 saved Japanese restaurants, with dated evidence and guarded database updates. This is an existing-catalog snapshot, not a claim of universal research success.
- Load the real saved catalog after a loading state, with retry on failure, rather than briefly rendering bundled demonstration records.

Implementation, deployed evidence and known failures are recorded in [development status](status.md) and the [restaurant regression report](restaurant-enrichment-regression.md). Controlled fixtures, live provider checks and database/browser readback are separate evidence. None proves that all restaurants or all countries will succeed.

## Planned, not implemented

| Direction                         | Intended outcome                                                                           | Current state                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Architecture and event intake     | Entity-specific research, venue/date/location checks, benchmarks and complete Add journeys | Existing record types and displays provide a foundation                 |
| International restaurant coverage | Regional identity, ratings, booking and schedule verification                              | Overseas paths and fixtures exist; broader live coverage remains open   |
| Agent frameworks                  | Portable application tools for Hermes, OpenClaw, Pi and other compatible clients           | Planned interfaces only; no certified packages                          |
| Messaging channels                | Add, Recommend and Record through WhatsApp, WeChat, Telegram, LINE and other channels      | No shipped adapters, pairing or live channel journeys                   |
| Image interpretation              | Reviewed place/visit drafts from original images and captions                              | Manual upload/display exists; extraction and its benchmarks are pending |
| iOS                               | An interface using the same application operations                                         | No iOS client                                                           |
| Bulk Google references            | Explicit save/replacement of eligible loaded scores with safe partial retries              | Per-restaurant save/replacement is implemented                          |

The [planned integration boundary](architecture.md#planned-agent-and-chat-interfaces) describes responsibilities and validation. A framework's advertised channel or model support does not establish Place Atlas interoperability. The first proposed chat implementation focuses on restaurants; architecture/event chat workflows need their own later validation.

## Naming and compatibility

The project and repository are now Place Atlas / `place-atlas`. The original repository was `jp-food-event-map`, and the 0.1 website displays Japan Atlas. Historical release evidence, Japanese place names and existing user records remain intact. Internal package identifiers, migration directories and `japan-atlas-*` Cloudflare resources are retained for upgrade compatibility. A repository rename does not migrate or recreate anyone's database, storage or deployed website.
