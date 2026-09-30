import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms — Japan Atlas',
  description: 'Terms for using the Japan Atlas personal field guide.',
};

export default function TermsPage() {
  return (
    <main className="policy-shell">
      <header className="policy-header">
        <Link className="policy-brand" href="/">
          <span aria-hidden="true">旅</span>
          Japan Atlas
        </Link>
        <nav aria-label="Policy navigation">
          <Link aria-current="page" href="/terms">
            Terms
          </Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </header>

      <article className="policy-article">
        <p className="eyebrow">Public policy · effective 30 September 2026</p>
        <h1>Terms of use</h1>
        <p className="policy-lede">
          Japan Atlas is a personal field guide for browsing saved places and
          comparing practical travel options in Japan.
        </p>

        <section>
          <h2>Use of the Atlas</h2>
          <p>
            Anyone with the site link may read the published catalog, personal
            ratings and comments, visits, photos, and videos. Adding or editing
            data and running Recommend or other Agent operations require the
            Owner session. Do not attempt to bypass that access control or
            disrupt the service.
          </p>
        </section>

        <section>
          <h2>Route estimates</h2>
          <p>
            Walking results are estimates from Google Maps Platform and are
            shown with their source and check time. They are decision support,
            not a guarantee of arrival time, accessibility, opening hours, queue
            length, or walk-in availability. Confirm time-sensitive details with
            the venue and your transport provider.
          </p>
        </section>

        <section>
          <h2>Sources and availability</h2>
          <p>
            Place details may come from official sites, restaurant listings, and
            personal records. Source facts can change. Provider quotas,
            maintenance, or network failures may temporarily disable Recommend
            without changing the saved catalog.
          </p>
        </section>

        <section>
          <h2>Adding a place</h2>
          <p>
            Add is an Owner-only, preview-and-confirm action. Google Places is
            used only for transient discovery and Place ID identity; its
            candidate content is not persisted or rendered on Leaflet. Public
            Nominatim may provide durable OpenStreetMap location evidence under
            its attribution and ODbL terms. Provider limits or uncertainty can
            leave fields unknown or require manual review instead of publishing
            an unverified place. Use of Google-provided route and place content
            is also subject to the{' '}
            <a
              href="https://cloud.google.com/maps-platform/terms"
              target="_blank"
              rel="noreferrer"
            >
              Google Maps Platform Terms of Service
            </a>
            .
          </p>
        </section>

        <section>
          <h2>Questions</h2>
          <p>
            Read the <Link href="/privacy">Privacy notice</Link> for location
            and personal-data handling. Policy updates will be published on this
            page with a new effective date.
          </p>
        </section>
      </article>
    </main>
  );
}
