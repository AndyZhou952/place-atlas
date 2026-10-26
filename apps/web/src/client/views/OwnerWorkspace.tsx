import { Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { AddPanel } from './AddPanel.tsx';
import { RecommendPanel } from './RecommendPanel.tsx';

export type OwnerWorkspaceTool = 'add' | 'recommend';

/** The Owner's side drawer; each tool keeps its draft while switching or closing. */
export function OwnerWorkspace({
  activeTool,
  onToolChange,
  onClose,
  onCommitted,
  onSelect,
}: {
  readonly activeTool?: OwnerWorkspaceTool;
  readonly onToolChange: (tool: OwnerWorkspaceTool) => void;
  readonly onClose: () => void;
  readonly onCommitted: () => void;
  readonly onSelect: (id: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!activeTool) {
      dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
    dialog
      .querySelector<HTMLInputElement>(
        activeTool === 'add' ? '#catalog-intake-query' : '#nearby-location',
      )
      ?.focus();
  }, [activeTool]);

  return (
    <dialog
      ref={dialogRef}
      id="owner-workspace"
      className="owner-workspace"
      aria-labelledby="owner-workspace-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <header className="owner-workspace-header">
        <div>
          <p className="eyebrow">Owner tools</p>
          <h2 id="owner-workspace-title">Your workspace</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close workspace"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      <nav className="owner-workspace-tools" aria-label="Workspace tools">
        {(
          [
            ['add', Plus, 'Add a place'],
            ['recommend', Sparkles, 'Recommend'],
          ] as const
        ).map(([tool, Icon, label]) => (
          <button
            key={tool}
            type="button"
            className={activeTool === tool ? 'button' : 'button outline'}
            aria-pressed={activeTool === tool}
            onClick={() => onToolChange(tool)}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
      <div className="owner-workspace-content">
        <div hidden={activeTool !== 'add'}>
          <AddPanel onCommitted={onCommitted} onOpenSaved={onSelect} />
        </div>
        <div hidden={activeTool !== 'recommend'}>
          <RecommendPanel onSelect={onSelect} />
        </div>
      </div>
    </dialog>
  );
}
