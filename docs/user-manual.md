# Japan Atlas Owner manual

Japan Atlas is a personal place map. The browser and Agent API share application operations; the Agent does not write the database directly.

## Public view and Owner mode

Anyone can view published places. Only a logged-in Owner can Add or edit places, toggle liked/visited, set a personal rating, write an overall comment, create a dated Visit, and upload photos. Each Journal photo can have a caption. Avoid sensitive information in content intended for public display.

## Browser Add

1. Log in and open **Add a place**.
2. Enter a restaurant name and, when useful, a branch, station, neighborhood, or address.
3. Choose the intended Google Places candidate.
4. Review the Preview, including address, coordinates, warnings, and unknown fields.
5. Confirm or cancel.

A confirmed place with sufficient evidence enters the map. Otherwise it becomes a `needs-review` candidate and must remain visible to the Owner. When the repository-owned Agent Service is configured, it uses DeepSeek to extract supported Tabelog and reservation facts from bounded web evidence. Google review, category, and signature dishes are not yet automated.

## Record

Use place detail for personal state, personal rating, and overall comment. Use Journal for dated Visit notes and photos. Photo captions are optional. A real Visit keeps the place in visited state.

## Nearby

Enter a neighborhood or address. Nearby compares verified saved places only; it does not discover unrelated restaurants. If the route provider is unavailable, the result may fall back to straight-line distance.

## OpenClaw commands

Exact commands use the lowercase project prefix shown in the marked examples and call the same deterministic operations as the browser.

```jpmap-valid
/jpmap nearby 银座
/jpmap nearby 東京都中央区銀座4丁目
/jpmap add 鮨青空 银座
/jpmap add Recoco Record 渋谷
/jpmap add select 1
/jpmap add select 2
/jpmap add confirm
/jpmap add cancel
```

These are invalid:

```jpmap-invalid
/jpmap nearby
/jpmap add select 4
/jpmap add
```

## Recovery states

| Result | Meaning | Action |
|---|---|---|
| one candidate from name only | A likely identity was found | Verify the address before selecting |
| multiple candidates | The name is ambiguous | Choose by address, or cancel and retry with a branch/area |
| `unknown` | No durable evidence is available | Do not interpret it as “no”; research later |
| `needs-review` | Saved for Owner review | It is not yet on the public map or in Nearby |
| `expired` | The Add session expired | Restart Add with the original clue |
| `conflict` | Evidence changed before confirm | Review the refreshed Preview |
| temporarily unavailable | A provider or dependency failed | Retry later; the operation did not write |

## Current limits

The repository includes the Agent Service, but each deployment must configure its protected DeepSeek key, HTTPS relay connection, and signed trust keys before automatic Tabelog/reservation research can be enabled. Conversational Record, screenshot intake, and screenshot-based Nearby are not implemented. The current Review surface is not a full catalog editor. Unknown external facts remain unknown instead of being guessed.
