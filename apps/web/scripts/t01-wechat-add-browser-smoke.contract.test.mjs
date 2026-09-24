import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('./t01-wechat-add-browser-smoke.mjs', import.meta.url),
  'utf8',
);

test('T-01 screenshot harness renders raw production presenter output with one fixed shell', () => {
  assert.match(
    source,
    /import \{ presentWechatCatalogIntake \} from '\.\.\/product\/application\/conversation\/wechat-catalog-intake-presenter\.ts'/u,
  );
  assert.match(source, /element\.textContent = text/u);
  assert.match(source, /assert\.equal\(metrics\.textContent, replyText\)/u);
  assert.match(source, /const viewport = \{ width: 390, height: 844 \}/u);
  assert.equal((source.match(/function shellHtml\(/gu) ?? []).length, 1);
  assert.doesNotMatch(source, /innerHTML = text|scenario\.css|rewriteReply/u);
});
