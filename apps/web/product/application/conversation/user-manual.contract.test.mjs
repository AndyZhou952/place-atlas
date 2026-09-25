import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import { createProjectCommandRouter } from './project-command-router.ts';

const manualUrl = new URL(
  '../../../../../docs/user-manual.md',
  import.meta.url,
);
const readmeUrl = new URL('../../../../../README.md', import.meta.url);
const docsUrl = new URL('../../../../../docs/', import.meta.url);

test('Owner manual marks every jpmap example and production parser accepts exactly the valid set', async () => {
  const manual = await readFile(manualUrl, 'utf8');
  const examples = markedJpmapExamples(manual);
  assert.equal(examples.valid.length >= 7, true);
  assert.equal(examples.invalid.length >= 1, true);
  assert.doesNotMatch(examples.unmarkedText, /\/jpmap\b/u);

  const parserFixture = createProjectCommandRouter(createAtlasApplication({}));
  for (const command of examples.valid) {
    const result = await parserFixture.dispatch(command);
    assert.equal(
      !result.ok && result.error.kind === 'invalid_input',
      false,
      `expected production parser to accept: ${command}`,
    );
  }
  for (const command of examples.invalid) {
    const result = await parserFixture.dispatch(command);
    assert.equal(result.ok, false, command);
    assert.equal(result.error.kind, 'invalid_input', command);
  }
});

test('manual covers current Owner paths, recovery states, and explicit limitations', async () => {
  const manual = await readFile(manualUrl, 'utf8');
  for (const required of [
    'Public view',
    'Owner mode',
    'liked',
    'visited',
    'personal rating',
    'overall comment',
    'Visit',
    'photos',
    'Add',
    'Review',
    'Nearby',
    'name only',
    'multiple candidates',
    'unknown',
    'needs-review',
    'expired',
    'conflict',
    'temporarily unavailable',
    'DeepSeek',
    'Tabelog',
    'reservation',
    'category',
    'signature dishes',
    'Record',
  ]) {
    assert.match(manual, new RegExp(required, 'u'), required);
  }
});

test('README links the Owner manual before quick start and documentation contains no secret-shaped content', async () => {
  const [manual, readme] = await Promise.all([
    readFile(manualUrl, 'utf8'),
    readFile(readmeUrl, 'utf8'),
  ]);
  const link = '[Owner manual](docs/user-manual.md)';
  assert.equal(readme.includes(link), true);
  assert.equal(
    readme.indexOf(link) < readme.indexOf('## Local development'),
    true,
  );

  const docNames = (await readdir(docsUrl, { recursive: true })).filter(
    (name) => name.endsWith('.md'),
  );
  const documentation = [
    readme,
    manual,
    ...(await Promise.all(
      docNames.map((name) => readFile(new URL(name, docsUrl), 'utf8')),
    )),
  ].join('\n');
  for (const forbidden of [
    /\bsk-[A-Za-z0-9_-]{20,}\b/u,
    /\bAIza[0-9A-Za-z_-]{30,}\b/u,
    /\bcfut_[0-9A-Za-z_-]+\b/u,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    /\bJPMAP_AGENT_[A-Z_]+\b/u,
    /\bATLAS_OWNER_(?:PASSWORD|SESSION_SECRET)\b/u,
    /\/api\/agent\//u,
    /\breceiptRef\b/u,
  ]) {
    assert.doesNotMatch(documentation, forbidden);
  }
});

function markedJpmapExamples(markdown) {
  const valid = [];
  const invalid = [];
  const unmarkedText = markdown.replace(
    /```(jpmap-valid|jpmap-invalid)\n([\s\S]*?)```/gu,
    (_block, kind, body) => {
      const commands = body
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      assert.equal(commands.length > 0, true, kind);
      for (const command of commands) {
        assert.match(command, /^\/jpmap\b/u);
        (kind === 'jpmap-valid' ? valid : invalid).push(command);
      }
      return '';
    },
  );
  return { valid, invalid, unmarkedText };
}
