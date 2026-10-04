import { writeFileSync } from 'node:fs';

import {
  captureResetEvidence,
  dryRunAssessmentReset,
  readResetEvidence,
  rehearseAssessmentReset,
  type ResetEvidencePhase,
  verifyAssessmentReset,
} from '../lib/maintenance/assessment-reset.ts';

const usage = `Usage:
  npm run maintenance:assessment-reset -- dry-run --database-copy <local.sqlite>
  npm run maintenance:assessment-reset -- capture --phase <before|after> --maintenance-id <id> --capture-id <id> --source-scope <scope> --captured-at <ISO-time> --database-copy <local.sqlite> --r2-manifest <keys.json> --output <evidence.json>
  npm run maintenance:assessment-reset -- rehearse --before-d1 <before.snapshot.sqlite> --after-d1 <new-after.snapshot.sqlite> --before-r2 <before.json> --after-r2 <new-after.json> --maintenance-id <id> --before-capture-id <id> --after-capture-id <id> --source-scope <scope> --captured-at <ISO-time> --before-evidence <new-before.json> --after-evidence <new-after.json>
  npm run maintenance:assessment-reset -- verify --before-evidence <before.json> --after-evidence <after.json>

This command has no remote/production mode. No database was changed.`;

const modeOptions = {
  'dry-run': ['--database-copy'],
  capture: [
    '--phase',
    '--maintenance-id',
    '--capture-id',
    '--source-scope',
    '--captured-at',
    '--database-copy',
    '--r2-manifest',
    '--output',
  ],
  rehearse: [
    '--before-d1',
    '--after-d1',
    '--before-r2',
    '--after-r2',
    '--maintenance-id',
    '--before-capture-id',
    '--after-capture-id',
    '--source-scope',
    '--captured-at',
    '--before-evidence',
    '--after-evidence',
  ],
  verify: ['--before-evidence', '--after-evidence'],
} as const;

type MaintenanceMode = keyof typeof modeOptions;

export function runAssessmentResetMaintenance(argv: readonly string[]): number {
  try {
    const parsed = parseArguments(argv);
    if (parsed.mode === 'dry-run') {
      writeResult(dryRunAssessmentReset(parsed.values['--database-copy']));
      return 0;
    }
    if (parsed.mode === 'capture') {
      const phase = parsePhase(parsed.values['--phase']);
      const evidence = captureResetEvidence({
        databasePath: parsed.values['--database-copy'],
        r2ManifestPath: parsed.values['--r2-manifest'],
        metadata: {
          maintenanceId: parsed.values['--maintenance-id'],
          captureId: parsed.values['--capture-id'],
          phase,
          sourceScope: parsed.values['--source-scope'],
          capturedAt: parsed.values['--captured-at'],
        },
      });
      writeJsonExclusive(parsed.values['--output'], evidence);
      writeResult({ ok: true, mode: 'capture', phase });
      return 0;
    }
    if (parsed.mode === 'rehearse') {
      const result = rehearseAssessmentReset({
        beforeDatabasePath: parsed.values['--before-d1'],
        afterDatabasePath: parsed.values['--after-d1'],
        beforeR2ManifestPath: parsed.values['--before-r2'],
        afterR2ManifestPath: parsed.values['--after-r2'],
        maintenanceId: parsed.values['--maintenance-id'],
        beforeCaptureId: parsed.values['--before-capture-id'],
        afterCaptureId: parsed.values['--after-capture-id'],
        sourceScope: parsed.values['--source-scope'],
        capturedAt: parsed.values['--captured-at'],
      });
      writeJsonExclusive(parsed.values['--before-evidence'], result.before);
      writeJsonExclusive(parsed.values['--after-evidence'], result.after);
      writeResult({
        mode: result.mode,
        verification: result.verification,
        idempotent: result.idempotent,
      });
      return 0;
    }
    const report = verifyAssessmentReset({
      before: readResetEvidence(parsed.values['--before-evidence']),
      after: readResetEvidence(parsed.values['--after-evidence']),
    });
    writeResult(report);
    return report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Maintenance validation failed.'}\nNo remote or production database was contacted; a local rehearsal copy may have been opened.\n`,
    );
    return 2;
  }
}

function parseArguments(argv: readonly string[]): {
  readonly mode: MaintenanceMode;
  readonly values: Readonly<Record<string, string>>;
} {
  if (argv.length === 0) throw new TypeError(usage);
  for (const token of argv) {
    if (/remote|production|cloudflare/iu.test(token)) {
      throw new TypeError(`Forbidden maintenance argument rejected: ${token}`);
    }
  }
  const [modeValue, ...tokens] = argv;
  if (!isMaintenanceMode(modeValue)) {
    throw new TypeError(`Unknown maintenance mode rejected.\n${usage}`);
  }
  const allowed = new Set<string>(modeOptions[modeValue]);
  const values: Record<string, string> = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const name = tokens[index];
    const value = tokens[index + 1];
    if (!name?.startsWith('--') || !allowed.has(name)) {
      throw new TypeError(`Unknown or positional argument rejected: ${name}`);
    }
    if (name in values) {
      throw new TypeError(`Duplicate argument rejected: ${name}`);
    }
    if (!value || value.startsWith('--')) {
      throw new TypeError(`Missing value for ${name}.`);
    }
    values[name] = value;
  }
  for (const required of allowed) {
    if (!(required in values)) {
      throw new TypeError(`Missing required argument ${required}.`);
    }
  }
  return { mode: modeValue, values };
}

function isMaintenanceMode(
  value: string | undefined,
): value is MaintenanceMode {
  return value !== undefined && value in modeOptions;
}

function parsePhase(value: string): ResetEvidencePhase {
  if (value !== 'before' && value !== 'after') {
    throw new TypeError('Evidence phase must be before or after.');
  }
  return value;
}

function writeJsonExclusive(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

function writeResult(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], 'file:').href
) {
  process.exitCode = runAssessmentResetMaintenance(process.argv.slice(2));
}
