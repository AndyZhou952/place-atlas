import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function runScorerCli(moduleUrl, score, usage) {
  if (!process.argv[1] || moduleUrl !== pathToFileURL(process.argv[1]).href)
    return;
  try {
    const [goldPath, predictionsPath] = process.argv.slice(2);
    if (!goldPath || !predictionsPath) throw new Error(usage);
    const [gold, predictions] = await Promise.all(
      [goldPath, predictionsPath].map((path) =>
        readFile(path, 'utf8').then(JSON.parse),
      ),
    );
    const report = score(gold, predictions);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passes ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
