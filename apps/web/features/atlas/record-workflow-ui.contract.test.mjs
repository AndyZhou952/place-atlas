import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const screenSource = await readFile(
  new URL('./atlas-screen.tsx', import.meta.url),
  'utf8',
);
const cssSource = await readFile(
  new URL('../../app/globals.css', import.meta.url),
  'utf8',
);

test('place detail and Journal share one Visit composer', () => {
  assert.match(screenSource, /function VisitComposer\(/u);
  assert.match(
    screenSource,
    /<VisitComposer\s+key=\{item\.id\}\s+vm=\{vm\}\s+itemId=\{item\.id\}/u,
  );
  assert.match(
    screenSource,
    /<VisitComposer vm=\{vm\} idPrefix="journal" \/>/u,
  );
  assert.match(screenSource, /type="date"/u);
  assert.match(screenSource, /マイスコア \/ 10/u);
  assert.match(screenSource, /Note \(optional\)/u);
  assert.match(
    screenSource,
    /accept="image\/jpeg,image\/png,image\/webp,image\/gif,video\/mp4,video\/webm"/u,
  );
});

test('place detail history reuses editable Visit and media behavior', () => {
  const detailStart = screenSource.indexOf('function PlaceDetail');
  const detailEnd = screenSource.indexOf('function JournalWorkspace');
  const detailSource = screenSource.slice(detailStart, detailEnd);

  assert.match(detailSource, /<JournalVisitRow/u);
  assert.match(detailSource, /onSave=\{vm\.editVisit\}/u);
  assert.match(detailSource, /onUpload=\{vm\.addVisitMedia\}/u);
  assert.match(detailSource, /onSaveCaption=\{vm\.saveMediaCaption\}/u);
  assert.match(detailSource, /onDeleteMedia=\{vm\.removeMedia\}/u);
  assert.match(detailSource, /<DeleteVisitDialog/u);
  assert.match(screenSource, /placeholder="What is this\?"/u);
  assert.match(screenSource, /Delete this \$\{kind\}\?/u);
});

test('Visit composition shows brief success feedback and then unlocks', () => {
  assert.match(
    screenSource,
    /status === 'saving'[\s\S]*?'Saving…'[\s\S]*?savedVisitId[\s\S]*?'Visit saved'[\s\S]*?'Save visit'/u,
  );
  assert.match(
    screenSource,
    /<output id=\{feedbackId\} className="visit-saved-toast"/u,
  );
  assert.match(screenSource, /\}, 1700\);/u);
  assert.match(
    screenSource,
    /The visit was saved, but some media did not upload/u,
  );
});

test('saved visits cannot be resubmitted, including after photo failure', () => {
  assert.match(
    screenSource,
    /if \(submitting.current \|\| savedVisitId \|\| vm.journalBusy\) return/u,
  );
  assert.match(screenSource, /setSavedVisitId\(result.visit.id\)/u);
  assert.match(
    screenSource,
    /status !== 'success' \|\| retryUpload \|\| formError\)/u,
  );
  assert.match(screenSource, /Continue without remaining media/u);
  assert.doesNotMatch(screenSource, /Record another visit/u);
  assert.match(screenSource, /Overall マイスコア/u);
  assert.match(screenSource, /not a separate visit score/u);
});

test('record controls keep mobile-sized edit, delete, and upload targets', () => {
  assert.match(
    cssSource,
    /\.journal-visit-actions button\s*\{[^}]*width:\s*2\.75rem;[^}]*height:\s*2\.75rem;/u,
  );
  assert.match(
    cssSource,
    /\.media-thumbnail-delete\s*\{[^}]*width:\s*2\.2rem;[^}]*height:\s*2\.2rem;/u,
  );
  assert.match(cssSource, /@media \(hover: none\)/u);
  assert.match(
    cssSource,
    /\.media-upload-control\s*\{[^}]*min-height:\s*2\.75rem;/u,
  );
});
