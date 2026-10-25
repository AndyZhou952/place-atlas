import { KeyRound, Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAtlas } from '../viewmodels/useAtlas.ts';
import { useOwner } from '../viewmodels/useOwner.ts';
import { AddPanel } from './AddPanel.tsx';
import { JournalView } from './JournalView.tsx';
import { MapView } from './MapView.tsx';
import { OwnerPanel } from './OwnerPanel.tsx';
import { PolicyPage } from './PolicyPage.tsx';
import { RecommendPanel } from './RecommendPanel.tsx';
import { TableView } from './TableView.tsx';

const VIEWS = [
  ['/', 'Map'],
  ['/table', 'Table'],
  ['/journal', 'Journal'],
] as const;

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const navigate = (next: string) => {
    if (next !== window.location.pathname) window.history.pushState(null, '', next);
    setPath(next);
    window.scrollTo(0, 0);
  };
  return [path, navigate] as const;
}

export function App() {
  const [path, navigate] = usePath();
  const owner = useOwner();
  const atlas = useAtlas(owner.owner);
  const [selectedId, setSelectedId] = useState<string>();
  const [tool, setTool] = useState<'add' | 'recommend'>();

  const openRestaurant = (id: string) => {
    setSelectedId(id);
    setTool(undefined);
    navigate('/');
  };

  if (path === '/terms' || path === '/privacy')
    return <PolicyPage page={path.slice(1) as 'terms' | 'privacy'} navigate={navigate} />;

  return (
    <main className="shell">
      <header className="header">
        <button type="button" className="brand" onClick={() => navigate('/')}>
          <span className="seal" aria-hidden="true">
            旅
          </span>
          <span>
            <span className="eyebrow">Restaurant field guide</span>
            <strong>Japan Atlas</strong>
          </span>
        </button>
        <nav className="primary-nav" aria-label="Views">
          {VIEWS.map(([href, label]) => (
            <button
              key={href}
              type="button"
              aria-current={path === href ? 'page' : undefined}
              onClick={() => navigate(href)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button
            type="button"
            className="button outline"
            aria-expanded={owner.panelOpen}
            onClick={owner.togglePanel}
          >
            <KeyRound aria-hidden="true" />
            <span className="wide-only">{owner.owner ? 'Owner active' : 'Owner login'}</span>
          </button>
          {owner.owner ? (
            <>
              <button type="button" className="button outline" onClick={() => setTool('add')}>
                <Plus aria-hidden="true" />
                <span className="wide-only">Add restaurant</span>
              </button>
              <button type="button" className="button" onClick={() => setTool('recommend')}>
                <Sparkles aria-hidden="true" />
                <span className="wide-only">Recommend</span>
              </button>
            </>
          ) : null}
        </div>
      </header>

      {owner.panelOpen ? <OwnerPanel owner={owner} /> : null}
      {owner.owner ? (
        <Workspace tool={tool} onTool={setTool}>
          <div hidden={tool !== 'add'}>
            <AddPanel onSaved={() => void atlas.reload()} onOpen={openRestaurant} />
          </div>
          <div hidden={tool !== 'recommend'}>
            <RecommendPanel restaurants={atlas.restaurants} onOpen={openRestaurant} />
          </div>
        </Workspace>
      ) : null}

      {atlas.notice ? (
        <output className="notice">
          {atlas.notice}
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss"
            onClick={() => atlas.setNotice('')}
          >
            <X aria-hidden="true" />
          </button>
        </output>
      ) : null}
      {atlas.status === 'loading' ? <p className="notice">Loading saved restaurants…</p> : null}
      {atlas.status === 'error' ? (
        <p className="notice" role="alert">
          Could not load the atlas.{' '}
          <button
            type="button"
            className="button outline small"
            onClick={() => void atlas.reload()}
          >
            Retry
          </button>
        </p>
      ) : null}

      {atlas.status === 'ready' && path === '/' ? (
        <MapView
          atlas={atlas}
          owner={owner.owner}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      ) : null}
      {atlas.status === 'ready' && path === '/table' ? (
        <TableView atlas={atlas} owner={owner.owner} onOpen={openRestaurant} />
      ) : null}
      {atlas.status === 'ready' && path === '/journal' ? (
        <JournalView atlas={atlas} owner={owner.owner} />
      ) : null}

      <footer className="footer">
        <span>Japan Atlas · restaurant field guide</span>
        <nav aria-label="Legal">
          <a href="/terms" onClick={(event) => (event.preventDefault(), navigate('/terms'))}>
            Terms
          </a>
          <a href="/privacy" onClick={(event) => (event.preventDefault(), navigate('/privacy'))}>
            Privacy
          </a>
        </nav>
      </footer>
    </main>
  );
}

/** Owner tools share one modal dialog; each tool keeps its draft while switching or closing. */
function Workspace({
  tool,
  onTool,
  children,
}: {
  readonly tool?: 'add' | 'recommend';
  readonly onTool: (tool?: 'add' | 'recommend') => void;
  readonly children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!tool) dialog.current?.close();
    else if (!dialog.current?.open) dialog.current?.showModal();
  }, [tool]);
  return (
    <dialog
      ref={dialog}
      className="workspace"
      aria-label="Owner tools"
      onClose={() => onTool(undefined)}
    >
      <header className="workspace-header">
        <nav className="segmented" aria-label="Owner tools">
          <button type="button" aria-pressed={tool === 'add'} onClick={() => onTool('add')}>
            <Plus aria-hidden="true" /> Add restaurant
          </button>
          <button
            type="button"
            aria-pressed={tool === 'recommend'}
            onClick={() => onTool('recommend')}
          >
            <Sparkles aria-hidden="true" /> Recommend
          </button>
        </nav>
        <button
          type="button"
          className="icon-button"
          aria-label="Close"
          onClick={() => onTool(undefined)}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
