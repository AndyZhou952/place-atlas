# Foursquare Places API New — redacted probe

- Date: 2026-09-13.
- Purpose: confirm the isolated service key and current wire shape; this was not a performance test or production approval.
- Request: one search call using a Japanese restaurant name, Tokyo locality, and a limit of three.
- Result: HTTP 200 with three candidates.
- Required fields were present: stable place ID, name, formatted address, latitude, and longitude.
- The response used top-level coordinates rather than the legacy nested coordinate shape.
- No raw response, request header, credential, account identifier, or real place ID was retained. Repository fixtures are synthetic.
- Usage: one provider call. The PoC warn/hard gates remain 400/500 and fail closed at the hard limit.

Production remains blocked pending provider agreement, field-use, credential-restriction, billing, and attribution evidence. Rating remains `unknown/not_permitted`.
