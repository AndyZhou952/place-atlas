export interface ResearchSourcePolicy {
  canonicalize(url: string): string | undefined;
  authorizeCandidate(url: string): string | undefined;
  authorizeRedirect(fromUrl: string, toUrl: string): string | undefined;
  authorizeClaim(
    kind: 'tabelog' | 'reservation',
    url: string,
  ): string | undefined;
}

const tabelogHosts = new Set(['tabelog.com', 'www.tabelog.com']);

// Tabelog restaurant detail pages have a stable region / area / item shape.
// Search pages, rankings, user pages, and arbitrary same-origin endpoints are
// deliberately excluded from the first production research policy.
const tabelogRestaurantPath =
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?[a-z0-9_-]+\/A\d+\/A\d+\/\d+\/?$/iu;

export function createTabelogResearchSourcePolicy(): ResearchSourcePolicy {
  const canonicalize = (value: string) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return undefined;
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      url.hash !== '' ||
      !tabelogHosts.has(hostname) ||
      !tabelogRestaurantPath.test(url.pathname)
    ) {
      return undefined;
    }
    url.hostname = hostname;
    url.search = '';
    return url.toString();
  };
  return {
    canonicalize,
    authorizeCandidate: canonicalize,
    authorizeRedirect(fromUrl, toUrl) {
      const from = canonicalize(fromUrl);
      const to = canonicalize(toUrl);
      return from && to && restaurantIdentity(from) === restaurantIdentity(to)
        ? to
        : undefined;
    },
    authorizeClaim(_kind, url) {
      return canonicalize(url);
    },
  };
}

function restaurantIdentity(value: string): string | undefined {
  return new URL(value).pathname.match(/\/(\d+)\/?$/u)?.[1];
}
