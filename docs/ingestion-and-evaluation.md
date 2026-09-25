# Intake and evaluation

## Deterministic intake today

1. Normalize the Owner query.
2. Request identity candidates from Google Places.
3. Ask the Owner to choose when identity is ambiguous.
4. Build a preview with durable fields and explicit unknowns.
5. Confirm once, using idempotent mutation receipts.
6. Publish a verified record when minimum evidence is present; otherwise keep an actionable review candidate.

Browser and Agent API use this workflow. The selected provider identity and branch are carried through preview, research authorization, and model extraction; a subject-bound proposal must explicitly confirm a match. Production still needs an allowlisted source policy to prevent an unrelated search result from becoming evidence. Web research is not currently a production provider, so ratings, reservation rules, categories, and signature dishes may remain unknown.

## Semantic enrichment seam

The repository includes a bounded OpenAI-compatible extractor for Tabelog and reservation scalars. The DeepSeek configuration is one implementation of that port. It receives one already-fetched page, treats the body as untrusted data, returns only a strict proposal/no-evidence/stop result, and never writes directly to D1. It does not provide web search; before production use, the separate relay must fetch policy-approved evidence and bind it to the selected branch.

Category tags, signature dishes, Google ratings, full source collection, vague-language interpretation, and recommendations still require later typed contracts rather than a larger free-form prompt.

## Evaluation gate

Two offline, versioned benchmark packages live under `apps/web/evals`:

- `place-resolution` covers Japanese/Chinese/English aliases, short input, branch ambiguity, same-name collisions, and no-match cases. Ambiguous input must clarify; unsafe auto-resolution must remain zero.
- `place-enrichment` covers supported fields, provenance, stale/conflicting evidence, wrong branches, prompt injection, missing evidence, and provider failure. Unsupported claims must remain zero.

Run `npm run test:evals` for benchmark regressions. The checked-in perfect fixtures test the scorers themselves; a production candidate must generate a separate prediction file through an authorized live evaluation. Write visibility and end-to-end latency remain integration gates outside these offline datasets. Safety failures and invisible confirmed writes are hard failures.
