'use client';

import { useEffect, useRef } from 'react';
import { Plus, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CatalogIntakePanel } from './catalog-intake-panel';
import { RecommendSearch } from './recommend-search';
import './owner-workspace.css';

export type OwnerWorkspaceTool = 'add' | 'recommend';

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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close workspace"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <nav className="owner-workspace-tools" aria-label="Workspace tools">
        <Button
          variant={activeTool === 'add' ? 'default' : 'outline'}
          aria-pressed={activeTool === 'add'}
          onClick={() => onToolChange('add')}
        >
          <Plus />
          Add a place
        </Button>
        <Button
          variant={activeTool === 'recommend' ? 'default' : 'outline'}
          aria-pressed={activeTool === 'recommend'}
          onClick={() => onToolChange('recommend')}
        >
          <Sparkles />
          Recommend
        </Button>
      </nav>
      <div className="owner-workspace-content">
        <div hidden={activeTool !== 'add'}>
          <CatalogIntakePanel
            onCommitted={onCommitted}
            onOpenSaved={onSelect}
          />
        </div>
        <div hidden={activeTool !== 'recommend'}>
          <RecommendSearch onSelect={onSelect} />
        </div>
      </div>
    </dialog>
  );
}
