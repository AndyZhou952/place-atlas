function fold(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{Z}]/gu, '');
}

function includesAll(text, parts) {
  const folded = fold(text);
  return parts.every((part) => folded.includes(fold(part)));
}

function matchesOneVariant(text, variants = []) {
  return variants.some((parts) => includesAll(text, parts));
}

function sourcedUrlCheck(claim, expectedUrl, allowedUrls = [expectedUrl]) {
  if (!claim || typeof claim !== 'object' || !('value' in claim))
    return {
      pass: false,
      failure: 'missing',
      expected: expectedUrl,
      observed: null,
    };
  if (!allowedUrls.includes(claim.value))
    return {
      pass: false,
      failure: 'wrong',
      expected: expectedUrl,
      observed: claim.value,
      sourceUrl: claim.sourceUrl ?? null,
    };
  if (!claim.sourceUrl || !claim.observedAt)
    return {
      pass: false,
      failure: 'evidence',
      expected: expectedUrl,
      observed: claim.value,
      reason: 'exact URL claim lacks sourceUrl or observedAt',
    };
  return {
    pass: true,
    failure: null,
    expected: expectedUrl,
    observed: claim.value,
    sourceUrl: claim.sourceUrl,
  };
}

function observedSnapshotUrl(
  snapshot,
  expectedUrl,
  allowedUrls = [expectedUrl],
) {
  if (!snapshot || snapshot.status !== 'known')
    return {
      pass: false,
      failure: 'missing',
      expected: expectedUrl,
      observed: snapshot?.status ?? null,
    };
  if (!allowedUrls.includes(snapshot.url))
    return {
      pass: false,
      failure: 'wrong',
      expected: expectedUrl,
      observed: snapshot.url ?? null,
    };
  if (
    snapshot.provenance !== 'agent_observed' ||
    snapshot.freshness !== 'fresh' ||
    !snapshot.observedAt
  )
    return {
      pass: false,
      failure: 'evidence',
      expected: expectedUrl,
      observed: snapshot.url,
      reason: 'URL must be freshly observed by the agent',
    };
  return {
    pass: true,
    failure: null,
    expected: expectedUrl,
    observed: snapshot.url,
  };
}

function officialWebsiteCheck(claim, expected) {
  if (expected.status === 'unknown') {
    if (!claim)
      return { pass: true, failure: null, expected: 'unknown', observed: null };
    const value = claim?.value;
    if (typeof value !== 'string')
      return {
        pass: false,
        failure: 'wrong',
        expected: 'unknown',
        observed: value ?? claim,
      };
    let host;
    try {
      host = new URL(value).hostname.toLowerCase();
    } catch {
      host = '';
    }
    if (
      host.includes('instagram.com') ||
      host === 'x.com' ||
      host.endsWith('.x.com')
    )
      return {
        pass: false,
        failure: 'wrong',
        expected:
          'unknown standalone official website; social accounts are distinct',
        observed: value,
        reason: 'social URL was classified as official website',
      };
    return {
      pass: false,
      failure: 'wrong',
      expected: 'unknown standalone official website',
      observed: value,
    };
  }
  return sourcedUrlCheck(claim, expected.url, expected.allowedUrls);
}

/** Pure scorer. `expected` belongs to the local benchmark and is never request input. */
export function scoreRestaurantLinks(sample, observation) {
  const candidate = observation?.candidate;
  const candidateText = `${candidate?.transientName ?? ''} ${candidate?.transientAddress ?? ''}`;
  const namesMatch = sample.identity.nameVariants
    ? matchesOneVariant(candidate?.transientName, sample.identity.nameVariants)
    : includesAll(candidate?.transientName, sample.identity.nameIncludes ?? []);
  const addressMatch = sample.identity.addressVariants
    ? matchesOneVariant(
        candidate?.transientAddress,
        sample.identity.addressVariants,
      )
    : includesAll(
        candidate?.transientAddress,
        sample.identity.addressIncludes ?? [],
      );
  const identity = {
    pass: Boolean(candidate) && namesMatch && addressMatch,
    failure:
      Boolean(candidate) && namesMatch && addressMatch
        ? null
        : candidate
          ? 'identity'
          : observation?.providerFailure
            ? 'provider'
            : 'identity',
    expected: sample.identity,
    observed: candidate
      ? {
          name: candidate.transientName ?? null,
          address: candidate.transientAddress ?? null,
        }
      : null,
    candidateText,
  };

  const preview = observation?.preview;
  const checks = {
    identity,
    tabelog: observedSnapshotUrl(preview?.tabelog, sample.expected.tabelogUrl),
    officialWebsite: officialWebsiteCheck(
      preview?.profile?.officialWebsite,
      sample.expected.officialWebsite,
    ),
    profileBookingLink: sourcedUrlCheck(
      preview?.profile?.bookingLink,
      sample.expected.bookingUrl,
    ),
    reservationUrl: observedSnapshotUrl(
      preview?.reservation,
      sample.expected.bookingUrl,
      [sample.expected.bookingUrl, sample.expected.tabelogUrl],
    ),
  };
  const hasProviderWarning = (preview?.warnings ?? []).some(
    (warning) => warning.code === 'provider_unavailable',
  );
  if (observation?.providerFailure || hasProviderWarning) {
    for (const check of Object.values(checks)) {
      if (!check.pass && check.failure === 'missing')
        check.failure = 'provider';
    }
  }
  const passed = Object.values(checks).every((check) => check.pass);
  return {
    caseId: sample.id,
    pass: passed,
    checks,
    diagnostics: {
      stage: observation?.stage ?? 'unknown',
      providerFailure: Boolean(observation?.providerFailure),
      addressMismatchForMatchingName:
        Boolean(candidate) && namesMatch && !addressMatch,
      addressMismatchDiagnostic:
        Boolean(candidate) && namesMatch && !addressMatch
          ? {
              observedCandidateAddress: candidate.transientAddress ?? null,
              expectedBranchAddressSignatures:
                sample.identity.addressVariants ?? [],
              note: 'The candidate name matches but its observed address does not match the benchmark branch signature; this can block branch-specific enrichment. Causality is not established by the response alone.',
            }
          : null,
      researchWarnings: preview?.warnings ?? [],
      unknownFields: preview?.unknownFields ?? [],
      reservationStatus: preview?.reservation?.status ?? null,
      tabelogStatus: preview?.tabelog?.status ?? null,
    },
  };
}
