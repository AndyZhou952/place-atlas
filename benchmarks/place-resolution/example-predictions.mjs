// Scorer examples come from evaluator gold and are not model observations.
export function exampleResolutionPredictions(dataset) {
  return {
    schemaVersion: dataset.schemaVersion,
    datasetId: dataset.datasetId,
    predictions: dataset.cases.map(({ caseId, gold }) => {
      const prediction = {
        caseId,
        action: gold.expectedAction,
        candidateIdentityIds: gold.identityId ? [gold.identityId] : [],
      };
      if (gold.expectedAction === 'resolve')
        prediction.selectedIdentityId = gold.identityId;
      if (gold.expectedAction === 'clarify') {
        const policy = gold.clarificationPolicy;
        const offer = policy.acceptedModes.includes('offer_candidates');
        prediction.clarification = {
          mode: offer ? 'offer_candidates' : policy.acceptedModes[0],
          requestedHint: offer ? null : policy.requiredHint,
          question: offer
            ? null
            : 'Which restaurant, area, station or branch do you mean?',
          candidates: offer
            ? policy.allowedCandidates.map((candidate, index) => ({
                rank: index + 1,
                ...candidate,
              }))
            : [],
        };
      }
      return prediction;
    }),
  };
}
