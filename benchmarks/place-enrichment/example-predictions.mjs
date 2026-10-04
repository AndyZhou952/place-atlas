// Scorer examples only: this oracle must never supply predictions for a live run.
export function exampleEnrichmentPredictions(dataset) {
  return {
    schemaVersion: dataset.schemaVersion,
    datasetId: dataset.datasetId,
    predictions: dataset.cases.map((entry) => ({
      caseId: entry.caseId,
      result: materialize(entry.gold, entry.evidence),
    })),
  };
}

function materialize(value, sources) {
  if (!value.state) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        materialize(child, sources),
      ]),
    );
  }
  return {
    state: value.state,
    ...(value.value === undefined
      ? {}
      : { value: structuredClone(value.value) }),
    evidence: value.acceptedEvidenceIds.map((id) => {
      const source = sources.find((entry) => entry.evidenceId === id);
      if (!source)
        throw new Error('Example refers to missing source evidence.');
      return {
        evidenceId: id,
        provider: source.provider,
        sourceUrl: source.sourceUrl,
        observedAt: source.capturedAt,
      };
    }),
  };
}
