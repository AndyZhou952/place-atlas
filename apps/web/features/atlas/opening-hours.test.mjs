import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Exercise the actual React view without needing a browser or loading CSS in Node.
const require = createRequire(import.meta.url);
const source = await readFile(
  new URL('./opening-hours.tsx', import.meta.url),
  'utf8',
);
const compiled = ts
  .transpileModule(source.replace("import './opening-hours.css';", ''), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  })
  .outputText.replace(
    '"react/jsx-runtime"',
    JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href),
  )
  .replace(
    "'../../product/application/catalog/operating-hours'",
    JSON.stringify(
      new URL(
        '../../product/application/catalog/operating-hours.ts',
        import.meta.url,
      ).href,
    ),
  );
const { OpeningHours } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
const render = (value) =>
  renderToStaticMarkup(createElement(OpeningHours, { value }));

test('hours render as readable rows and advisories stay in a closed native disclosure', () => {
  const html = render(
    '月〜金 11:30–14:30（L.O. 14:00） / 17:30–翌01:00（L.O. 翌00:30）\n土・日・祝 12:00–22:00\n\n注意事項\n臨時休業は公式サイトをご確認ください。',
  );
  const rows = html.match(/<ul[^>]*>([\s\S]*?)<\/ul>/u)?.[1];
  assert.ok(rows);
  assert.equal((rows.match(/<li>/gu) ?? []).length, 2);
  assert.match(rows, /11:30–14:30/u);
  assert.match(rows, /翌01:00/u);
  assert.match(rows, /L\.O\. 翌00:30/u);
  assert.doesNotMatch(rows, /臨時休業/u);
  assert.match(
    html,
    /<details class="opening-hours-notes"><summary>注意事項<\/summary>/u,
  );
  assert.match(html, /臨時休業は公式サイトをご確認ください。/u);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/u);
});

test('legacy repeated weekdays present one grouped row without implying holiday hours', () => {
  const html = render(
    ['月', '火', '水', '木', '金', '土', '日']
      .map((day) => `${day} 11:00 - 22:00`)
      .join('\n'),
  );
  assert.equal((html.match(/<li>/gu) ?? []).length, 1);
  assert.match(html, /月〜日 11:00–22:00/u);
  assert.doesNotMatch(html, /毎日|<details/u);
});

test('unavailable and blank schedules preserve the existing honest unknown state', () => {
  for (const value of [undefined, '', '  ']) {
    const html = render(value);
    assert.match(html, />Unavailable</u);
    assert.doesNotMatch(html, /<ul|<details/u);
  }
});

test('saved details, collection table and intake preview share presentation without replacing editable inputs', async () => {
  for (const name of [
    'atlas-screen.tsx',
    'catalog-table.tsx',
    'catalog-intake-panel.tsx',
  ]) {
    const text = await readFile(new URL(`./${name}`, import.meta.url), 'utf8');
    assert.match(text, /<OpeningHours value=/u, name);
    if (name !== 'catalog-intake-panel.tsx') {
      assert.match(text, /href=\{item\.openingHours\.sourceUrl\}/u, name);
      assert.match(
        text,
        /item\.openingHours\.observedAt\.slice\(0, 10\)/u,
        name,
      );
    } else {
      assert.match(text, /value=\{intake\.state\[field\]\}/u);
      assert.match(text, /intake\.setField\(field, event\.target\.value\)/u);
    }
  }
});
