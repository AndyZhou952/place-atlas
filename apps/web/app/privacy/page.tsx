import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy — Japan Atlas',
  description: 'Privacy notice for the Japan Atlas personal field guide.',
};

export default function PrivacyPage() {
  return (
    <main className="policy-shell">
      <header className="policy-header">
        <Link className="policy-brand" href="/">
          <span aria-hidden="true">旅</span>
          Japan Atlas
        </Link>
        <nav aria-label="Policy navigation">
          <Link href="/terms">Terms</Link>
          <Link aria-current="page" href="/privacy">
            Privacy
          </Link>
        </nav>
      </header>

      <article className="policy-article">
        <p className="eyebrow">Public policy · effective 21 September 2026</p>
        <h1>Privacy notice</h1>
        <p className="policy-lede">
          Japan Atlas keeps its public reading surface separate from the private
          Owner controls and uses only the data needed for each action.
        </p>

        <section>
          <h2>What is public</h2>
          <p>
            Anyone with the URL can view published places, overall personal
            status and comments, visits, display metadata, and selected photo
            content. Storage keys, original filenames, hashes, internal IDs,
            audit data, and credentials are not part of the public view.
          </p>
        </section>

        <section>
          <h2>Location hints</h2>
          <p>
            Nearby starts only when you manually submit a neighborhood or
            address. Japan Atlas does not request browser geolocation. The hint
            and the coordinates of saved candidate places are sent to the
            private route service for that request. Provider responses are not
            written to the Atlas database or object storage, and are not sent to
            the language model or map renderer.
          </p>
        </section>

        <section>
          <h2>Google route service</h2>
          <p>
            Geocoding and walking estimates use Google Maps Platform. Google
            processes the request under its own{' '}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noreferrer"
            >
              Privacy Policy
            </a>
            . Japan Atlas retains only the structured result needed to show the
            current response, its attribution, source, and check time.
          </p>
        </section>

        <section>
          <h2>Owner data and retention</h2>
          <p>
            Owner edits are stored in the Atlas database; uploaded visit photos
            are stored in private object storage and exposed only through the
            published display projection. Authentication secrets remain in the
            hosting platform’s encrypted secret store.
          </p>
        </section>

        <section>
          <h2>More information</h2>
          <p>
            The <Link href="/terms">Terms of use</Link> explain route
            limitations and acceptable use. Policy updates will be published
            here with a new effective date.
          </p>
        </section>
      </article>
    </main>
  );
}
