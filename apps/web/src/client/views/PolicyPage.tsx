const POLICIES = {
  terms: {
    title: 'Terms of use',
    sections: [
      [
        'Use of the atlas',
        'Anyone with the link may read the published restaurants, personal ratings and comments, visits, photos and videos. Adding or editing data and using Recommend require the Owner session. Do not attempt to bypass that access control or disrupt the service.',
      ],
      [
        'Sources and accuracy',
        'Restaurant facts come from Tabelog listings, official websites and personal records, and can change. Ratings, opening hours and reservation rules are shown with their source and date; confirm time-sensitive details with the restaurant. Distances in Recommend are straight-line estimates, not walking times.',
      ],
      [
        'Third-party services',
        'Optional Google Maps content is used under the Google Maps Platform Terms of Service. Map tiles and geocoding come from OpenStreetMap under its attribution and ODbL terms.',
      ],
    ],
  },
  privacy: {
    title: 'Privacy notice',
    sections: [
      [
        'What is public',
        'Published restaurants, personal ratings and comments, visits, and their photos and videos are visible to anyone with the link, through opaque media links. Storage keys, original filenames, credentials and sessions are never public.',
      ],
      [
        'Owner requests',
        'When the Owner adds a restaurant, the search text is sent to a web search service and the chosen Tabelog listing is read, optionally through Firecrawl. If configured, Google Places matches the restaurant, and the listing text is sent to the configured language model to extract signature dishes. Recommend sends the request and a summary of saved restaurants to the model, and a mentioned starting point to OpenStreetMap Nominatim. The site does not request browser geolocation.',
      ],
      [
        'Storage',
        'Records are stored in the deployment’s own Cloudflare D1 database and photos in its R2 bucket. Model keys are encrypted with a server secret.',
      ],
    ],
  },
} as const;

export function PolicyPage({
  page,
  navigate,
}: {
  readonly page: keyof typeof POLICIES;
  readonly navigate: (path: string) => void;
}) {
  const policy = POLICIES[page];
  return (
    <main className="policy">
      <nav>
        <a href="/" onClick={(event) => (event.preventDefault(), navigate('/'))}>
          ← Japan Atlas
        </a>
        <a
          href="/terms"
          aria-current={page === 'terms' ? 'page' : undefined}
          onClick={(event) => (event.preventDefault(), navigate('/terms'))}
        >
          Terms
        </a>
        <a
          href="/privacy"
          aria-current={page === 'privacy' ? 'page' : undefined}
          onClick={(event) => (event.preventDefault(), navigate('/privacy'))}
        >
          Privacy
        </a>
      </nav>
      <article>
        <p className="eyebrow">Effective 25 October 2026</p>
        <h1>{policy.title}</h1>
        {policy.sections.map(([heading, body]) => (
          <section key={heading}>
            <h2>{heading}</h2>
            <p>{body}</p>
          </section>
        ))}
      </article>
    </main>
  );
}
