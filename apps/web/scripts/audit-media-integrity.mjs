// Read production metadata and stream R2 objects through a hash; no media is saved locally.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

if (process.env.ALLOW_PRODUCTION_MEDIA_AUDIT !== 'yes') {
  throw new Error(
    'Set ALLOW_PRODUCTION_MEDIA_AUDIT=yes for a read-only audit.',
  );
}

const database = 'japan-atlas-owner-poc';
const bucket = 'japan-atlas-owner-poc-media';
const config = 'wrangler.owner-poc.local.jsonc';

function command(args, onData) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stdout.on('data', onData);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Wrangler exited ${code}: ${stderr}`));
    });
  });
}

let metadataJson = '';
await command(
  [
    'd1',
    'execute',
    database,
    '--remote',
    '--config',
    config,
    '--json',
    '--command',
    'SELECT object_key, content_sha256, byte_size FROM visit_media',
  ],
  (chunk) => {
    metadataJson += chunk.toString('utf8');
  },
);
const rows = JSON.parse(metadataJson)?.[0]?.results;
if (!Array.isArray(rows)) {
  throw new Error('Invalid media metadata returned by production D1.');
}
const keys = new Set(rows.map((row) => row.object_key));
if (keys.size !== rows.length) {
  throw new Error('Duplicate R2 object key in media metadata.');
}

let next = 0;
let verifiedBytes = 0;
async function auditNext() {
  while (next < rows.length) {
    const index = next++;
    const row = rows[index];
    if (
      typeof row.object_key !== 'string' ||
      typeof row.content_sha256 !== 'string' ||
      !Number.isSafeInteger(row.byte_size)
    ) {
      throw new Error(`Invalid media metadata at row ${index}.`);
    }
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      await command(
        [
          'r2',
          'object',
          'get',
          `${bucket}/${row.object_key}`,
          '--remote',
          '--pipe',
        ],
        (chunk) => {
          bytes += chunk.length;
          hash.update(chunk);
        },
      );
    } catch {
      throw new Error(`R2 read failed for media row ${index}.`);
    }
    if (bytes !== row.byte_size || hash.digest('hex') !== row.content_sha256) {
      throw new Error(`Media size or SHA-256 differs at row ${index}.`);
    }
    verifiedBytes += bytes;
  }
}
await Promise.all(Array.from({ length: Math.min(4, rows.length) }, auditNext));
console.log(
  `Verified ${rows.length} D1-referenced R2 objects (${verifiedBytes} bytes).`,
);
