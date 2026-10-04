import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('scorer commands distinguish a passing run, a failed run and invalid input', async () => {
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'atlas-scorer-cli-')),
  );
  const command = join(folder, 'score.mjs');
  const gold = join(folder, 'gold.json');
  const predictions = join(folder, 'predictions.json');
  const helper = new URL('./scorer-cli.mjs', import.meta.url).href;
  try {
    await writeFile(
      command,
      `import { runScorerCli } from ${JSON.stringify(helper)}; await runScorerCli(import.meta.url, gold => ({ passes: gold.passes }), 'Two paths required');`,
    );
    await writeFile(predictions, '{}');
    for (const passes of [true, false]) {
      await writeFile(gold, JSON.stringify({ passes }));
      const result = spawnSync(process.execPath, [command, gold, predictions], {
        encoding: 'utf8',
      });
      assert.equal(result.status, passes ? 0 : 1);
      assert.equal(JSON.parse(result.stdout).passes, passes);
    }
    await writeFile(gold, '{');
    assert.equal(
      spawnSync(process.execPath, [command, gold, predictions]).status,
      2,
    );
    assert.equal(spawnSync(process.execPath, [command]).status, 2);
    const imported = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `import ${JSON.stringify(helper)}`],
      { encoding: 'utf8' },
    );
    assert.equal(imported.status, 0);
    assert.equal(imported.stdout, '');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
