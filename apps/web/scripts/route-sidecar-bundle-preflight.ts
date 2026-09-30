import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const allowedUrls = [
  'https://maps.googleapis.com/maps/api/geocode/json',
  'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
  'https://routes.googleapis.com/directions/v2:computeRoutes',
  'https://www.google.com/maps',
  'https://navitime-route-totalnavi.p.rapidapi.com/route_transit',
  'https://www.navitime.co.jp/',
] as const;

export function inspectRouteSidecarBundle(source: string): {
  readonly ready: boolean;
  readonly blockers: readonly string[];
} {
  const blockers: string[] = [];
  if (/foursquare|google-fixed-endpoint-transport/iu.test(source)) {
    blockers.push('forbidden_provider_capability');
  }
  if (
    [...allowedUrls.slice(0, 3), allowedUrls[4]].some(
      (url) => !source.includes(url),
    )
  ) {
    blockers.push('required_fixed_endpoint_missing');
  }
  const withoutAllowedUrls = allowedUrls.reduce(
    (value, url) => value.replaceAll(url, ''),
    source,
  );
  if (/https:\/\//u.test(withoutAllowedUrls)) {
    blockers.push('unexpected_network_endpoint');
  }
  return { ready: blockers.length === 0, blockers };
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    options: { bundle: { type: 'string', multiple: true } },
    strict: true,
  });
  const paths = parsed.values.bundle;
  if (!paths || paths.length < 1) {
    throw new Error('Route Sidecar bundle preflight requires bundle paths.');
  }
  const result = inspectRouteSidecarBundle(
    (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n'),
  );
  if (!result.ready) {
    throw new Error(
      `Route Sidecar bundle preflight failed: ${result.blockers.join(', ')}`,
    );
  }
  process.stdout.write('Route Sidecar bundle preflight passed.\n');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
