import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { auditArchitecture } from '../../scripts/architecture-fitness.ts';

const webRoot = fileURLToPath(new URL('../../', import.meta.url));
const productRoot = path.join(webRoot, 'product');
const apiRoot = path.join(webRoot, 'app/api');
const coreModelAliases = [
  'AtlasItemKind',
  'AtlasItem',
  'AtlasItemEdit',
  'PersonalState',
  'VerificationStatus',
  'ReservationMode',
  'SourceLink',
  'TabelogSnapshot',
  'ReservationSnapshot',
  'EventSchedule',
  'PlaceAssessment',
  'PlaceAssessmentPatch',
  'ImportJob',
  'ImportStatus',
  'NewImportJob',
  'VisitRecord',
  'VisitMediaRecord',
  'NewVisit',
  'VisitUpdate',
  'VisitCreateResult',
  'VisitMutationResult',
];

test('the production architecture satisfies the filesystem manifest', () => {
  assert.deepEqual(auditArchitecture(productionArchitectureManifest()), []);
});

test('default CI runs runtime boundary tests and compile-time catalog tests', () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(webRoot, 'package.json'), 'utf8'),
  );
  assert.match(packageJson.scripts.test, /node .*--test/u);
  assert.match(packageJson.scripts.typecheck, /tsc .*--noEmit/u);

  const tsconfig = readFileSync(path.join(webRoot, 'tsconfig.json'), 'utf8');
  assert.match(tsconfig, /"\*\*\/\*\.ts"/u);

  const ci = readFileSync(
    path.join(webRoot, '../../.github/workflows/ci.yml'),
    'utf8',
  );
  assert.match(ci, /run: npm test/u);
  assert.match(ci, /run: npm run typecheck/u);
});

test('fitness catches side-effect, static, export, dynamic, import-type, and require dependencies', () => {
  const cases = [
    `import '@/features/atlas/model';`,
    `import React from 'react';`,
    `import type { ReactNode } from 'react';`,
    `export { value } from 'next/server';`,
    `const lazy = import('@/db');`,
    `type External = import('@/features/atlas/model').External;`,
    `const loaded = require('drizzle-orm');`,
  ];
  for (const source of cases) {
    withArchitectureFixture(
      { 'product/application/forbidden.ts': source },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule }) => rule === 'forbidden_product_import',
          ),
          source,
        );
      },
    );
  }
});

test('fitness fails closed on a nonliteral dynamic import', () => {
  withArchitectureFixture(
    {
      'product/application/forbidden.ts': `const loaded = import(moduleName);`,
    },
    ({ manifest }) => {
      assert.ok(
        auditArchitecture(manifest).some(
          ({ rule }) => rule === 'nonliteral_module_import',
        ),
      );
    },
  );
});

test('fitness never exposes absolute or repository-external paths', () => {
  const sources = [
    `import '/Users/private-user/secret-module.ts?token=posix#fragment';`,
    String.raw`import 'C:\\Users\\private-user\\secret-module.ts?token=windows#fragment';`,
    String.raw`import '\\\\server\\private-share\\secret-module.ts?token=unc#fragment';`,
    `import 'file:///Users/private-user/secret-module.ts?token=file-url#fragment';`,
  ];
  for (const source of sources) {
    withArchitectureFixture(
      { 'product/application/absolute-import.ts': source },
      ({ manifest }) => {
        const output = JSON.stringify(auditArchitecture(manifest));
        assert.match(output, /<absolute:redacted>/u, source);
        assert.doesNotMatch(
          output,
          /private-user|private-share|secret-module|token=|fragment/u,
          source,
        );
        assert.doesNotMatch(
          output,
          /\/Users\/|[A-Za-z]:\\|\\\\server|file:\/\//u,
          source,
        );
      },
    );
  }
});

test('fitness reports repository paths relatively and redacts traversal paths', () => {
  withArchitectureFixture({}, ({ root, manifest }) => {
    const inside = path.join(root, 'product/application/private-owner.ts');
    const outside = path.join(path.dirname(root), 'private-external.ts');
    writeFileSync(
      path.join(root, 'product/application/absolute-import.ts'),
      `import '${inside}?secret=inside#fragment';\nimport '${outside}?secret=outside#fragment';`,
    );
    const output = JSON.stringify(auditArchitecture(manifest));
    assert.ok(!output.includes(root));
    assert.doesNotMatch(
      output,
      /private-owner|private-external|secret=|fragment|\.\.\//u,
    );
    assert.match(output, /<absolute:redacted>/u);
  });
});

test('fitness sanitizes filesystem paths in thrown errors', () => {
  withArchitectureFixture({}, ({ root, manifest }) => {
    const invalidRoot = path.join(
      root,
      'product/application/private-error-source.ts',
    );
    writeFileSync(invalidRoot, 'export const value = true;');
    assert.throws(
      () =>
        auditArchitecture({
          ...manifest,
          productionRoots: [invalidRoot],
        }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          'Architecture fitness failed: internal-error',
        );
        assert.doesNotMatch(
          error.message,
          /private-error-source|atlas-fitness-|\/var\/folders/u,
        );
        return true;
      },
    );
  });
});

test('fitness classifies every POSIX leading-slash form as one redacted value', () => {
  for (let slashCount = 1; slashCount <= 5; slashCount += 1) {
    const specifier = `${'/'.repeat(slashCount)}private-host/secret.ts?token=${slashCount}#hash`;
    withArchitectureFixture(
      {
        'product/application/absolute-import.ts': `import '${specifier}';`,
      },
      ({ manifest }) => {
        const details = auditArchitecture(manifest).map(({ detail }) => detail);
        assert.ok(details.includes('<absolute:redacted>'), specifier);
        assert.ok(
          details.every(
            (detail) =>
              !detail.includes('private-host') &&
              !detail.includes('token=') &&
              !detail.includes('nonlocanonlocal'),
          ),
          specifier,
        );
      },
    );
  }
});

test('fitness classifies mixed Windows and UNC separators without remnants', () => {
  for (const specifier of [
    String.raw`C:\\Users/private-user\\secret.ts?token=drive#hash`,
    String.raw`\\\\server/private-share\\secret.ts?token=unc#hash`,
    String.raw`/Users\\private-user/secret.ts?token=mixed#hash`,
  ]) {
    withArchitectureFixture(
      {
        'product/application/absolute-import.ts': `import '${specifier}';`,
      },
      ({ manifest }) => {
        const output = JSON.stringify(auditArchitecture(manifest));
        assert.match(output, /<absolute:redacted>/u, specifier);
        assert.doesNotMatch(
          output,
          /private-user|private-share|secret\.ts|token=|nonlocanonlocal/u,
          specifier,
        );
      },
    );
  }
});

test('fitness redaction is idempotent and preserves one canonical marker', () => {
  withArchitectureFixture(
    {
      'product/application/absolute-import.ts': `import '<absolute:redacted>';`,
    },
    ({ manifest }) => {
      const details = auditArchitecture(manifest).map(({ detail }) => detail);
      assert.ok(details.includes('<absolute:redacted>'));
      assert.ok(details.every((detail) => !detail.includes('nonlocal')));
    },
  );
});

test('fitness converts a proven repository-internal absolute path to relative', () => {
  withArchitectureFixture({}, ({ root, manifest }) => {
    const owner = path.join(
      root,
      'product/application/proven-internal-owner.ts',
    );
    writeFileSync(owner, 'export const value = true;');
    writeFileSync(
      path.join(root, 'product/application/absolute-import.ts'),
      `import '${owner}';`,
    );
    const details = auditArchitecture(manifest).map(({ detail }) => detail);
    assert.ok(details.includes('product/application/proven-internal-owner.ts'));
    assert.ok(details.every((detail) => !detail.includes(root)));
  });
});

test('fitness never publishes free-form module text with escaped delimiters', () => {
  const sources = [
    String.raw`const loaded = import(prefix + '/Users/private-user/single-secret.ts?token=single#fragment');`,
    String.raw`const loaded = import(prefix + "/Users/private-user/double-secret.ts?token=double#fragment");`,
    String.raw`const loaded = import(prefix + "/Users/private-user/escaped-\"delimiter-secret.ts?token=escaped#fragment");`,
    'const loaded = import(prefix + `/Users/private-user/backtick-secret.ts?token=backtick#fragment`);',
    'const loaded = import(prefix + `/Users/private-user/秘密-newline-secret.ts?token=unicode#fragment\ncontinued`);',
    String.raw`const loaded = import(prefix + 'C:\\Users\\private-user\\backslash-secret.ts?token=windows#fragment');`,
  ];
  for (const source of sources) {
    withArchitectureFixture(
      { 'product/application/free-form-import.ts': source },
      ({ manifest }) => {
        const violations = auditArchitecture(manifest);
        const output = JSON.stringify(violations);
        assert.ok(
          violations.some(
            ({ rule, file }) =>
              rule === 'nonliteral_module_import' &&
              file === 'product/application/free-form-import.ts',
          ),
          source,
        );
        assert.doesNotMatch(
          output,
          /private-user|secret\.ts|delimiter-secret|backtick-secret|newline-secret|backslash-secret|token=|fragment|continued|秘密/u,
          source,
        );
      },
    );
  }
});

test('fitness catches sibling operation imports with and without an extension', () => {
  for (const source of [
    `import './other-operations';`,
    `import './other-operations.ts';`,
  ]) {
    withArchitectureFixture(
      {
        'product/application/sample-operations.ts': `${source}\n${sampleOperation("'", "'")}`,
        'product/application/other-operations.ts': `export const other = true;`,
      },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule }) => rule === 'sibling_operation_import',
          ),
          source,
        );
      },
    );
  }
});

test('fitness accepts single and double quoted descriptors and fails closed on template or computed values', () => {
  for (const quote of ["'", '"']) {
    withArchitectureFixture(
      {
        'product/application/sample-operations.ts': sampleOperation(
          quote,
          quote,
        ),
      },
      ({ manifest }) => assert.deepEqual(auditArchitecture(manifest), []),
    );
  }

  for (const replacement of [
    'key: `sample.read`',
    'key: operationKey',
    "[operationKey]: 'sample.read'",
    'resultKind: `json`',
  ]) {
    withArchitectureFixture(
      {
        'product/application/sample-operations.ts': sampleOperation(
          "'",
          "'",
        ).replace(/key: 'sample\.read'|resultKind: 'json'/u, replacement),
      },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule }) => rule === 'operation_descriptor_nonliteral',
          ),
          replacement,
        );
      },
    );
  }
});

test('fitness catches duplicate and missing keys plus duplicate group composition', () => {
  withArchitectureFixture(
    {
      'product/application/duplicate-operations.ts': sampleOperation("'", "'")
        .replaceAll('sampleOperation', 'duplicateOperation')
        .replaceAll(
          'createSampleOperationGroup',
          'createDuplicateOperationGroup',
        ),
      'lib/server/application/server-atlas-application.ts': `
        import { createSampleOperationGroup } from '@/product/application/sample-operations';
        import { createAtlasApplication } from '@/product/application/atlas-application';
        export function createServerAtlasApplication() {
          return createAtlasApplication({
            ...createSampleOperationGroup(),
            ...createSampleOperationGroup(),
          });
        }
      `,
    },
    ({ manifest }) => {
      const violations = auditArchitecture({
        ...manifest,
        expectedOperationKeys: ['sample.read', 'missing.read'],
      });
      assert.ok(
        violations.some(({ rule }) => rule === 'duplicate_operation_key'),
      );
      assert.ok(
        violations.some(({ rule }) => rule === 'missing_operation_key'),
      );
      assert.ok(
        violations.some(({ rule }) => rule === 'operation_group_count'),
      );
    },
  );
});

test('fitness catches dependency cycles', () => {
  withArchitectureFixture(
    {
      'product/application/a.ts': `import './b';`,
      'product/application/b.ts': `import './a.ts';`,
    },
    ({ manifest }) => {
      assert.ok(
        auditArchitecture(manifest).some(
          ({ rule }) => rule === 'dependency_cycle',
        ),
      );
    },
  );
});

test('fitness catches route imports, direct SQL, and a second Browser mapping', () => {
  withArchitectureFixture(
    {
      'app/api/unsafe/route.ts': `import '@/lib/server/atlas-store';`,
      'features/atlas/second-mapping.ts': `
        export const second = {
          demo: { key: 'demo', method: 'GET', path: '/api/demo', bodyKind: 'none' },
        };
      `,
    },
    ({ manifest }) => {
      const rules = auditArchitecture(manifest).map(({ rule }) => rule);
      assert.ok(rules.includes('route_storage_bypass'));
      assert.ok(rules.includes('second_browser_mapping'));
    },
  );

  withArchitectureFixture(
    {
      'app/api/unsafe/route.ts': `
        const statement = 'SELECT item_id FROM place_assessments';
        void statement;
      `,
    },
    ({ manifest }) => {
      assert.ok(
        auditArchitecture(manifest).some(
          ({ rule }) => rule === 'route_storage_bypass',
        ),
      );
    },
  );
});

test('fitness catches second search, rating, and effective-visited implementations', () => {
  withArchitectureFixture(
    {
      'features/atlas/duplicate-search.ts': `function matchesAtlasQuery() { return true; }`,
      'features/atlas/duplicate-rating.ts': `function normalizeAssessmentRating(value: number) { return Math.round(value * 10) / 10; }`,
      'features/atlas/duplicate-visited.ts': `function visible(manualVisited: boolean, visitCount: number) { return manualVisited || visitCount > 0; }`,
    },
    ({ manifest }) => {
      const details = auditArchitecture(manifest)
        .filter(({ rule }) => rule === 'duplicate_business_policy')
        .map(({ detail }) => detail);
      assert.ok(details.some((detail) => detail.includes('search')));
      assert.ok(details.some((detail) => detail.includes('rating')));
      assert.ok(details.some((detail) => detail.includes('effectiveVisited')));
    },
  );
});

test('fitness catches retired files and UI model redeclarations', () => {
  withArchitectureFixture(
    {
      'lib/server/retired-store.ts': `export const retired = true;`,
      'features/atlas/model.ts': `export interface AtlasItem { readonly id: string }`,
    },
    ({ manifest }) => {
      const violations = auditArchitecture({
        ...manifest,
        retiredFiles: ['lib/server/retired-store.ts'],
      });
      assert.ok(violations.some(({ rule }) => rule === 'retired_file'));
      assert.ok(violations.some(({ rule }) => rule === 'duplicate_core_model'));
    },
  );
});

test('fitness rejects an inline rogue operation in the application catalog', () => {
  withArchitectureFixture(
    {
      'lib/server/application/server-atlas-application.ts': `
        import { createSampleOperationGroup } from '@/product/application/sample-operations';
        import { createAtlasApplication } from '@/product/application/atlas-application';
        const rogue = { descriptor: { key: 'rogue.read', resultKind: 'json' } };
        export function createServerAtlasApplication() {
          return createAtlasApplication({
            ...createSampleOperationGroup(),
            'rogue.read': rogue,
          });
        }
      `,
    },
    ({ manifest }) => {
      assert.ok(
        auditArchitecture(manifest).some(
          ({ rule }) => rule === 'unowned_catalog_entry',
        ),
      );
    },
  );
});

test('fitness rejects a floating operation group call', () => {
  withArchitectureFixture(
    {
      'lib/server/application/server-atlas-application.ts': `
        import { createSampleOperationGroup } from '@/product/application/sample-operations';
        import { createAtlasApplication } from '@/product/application/atlas-application';
        export function createServerAtlasApplication() {
          createSampleOperationGroup();
          return createAtlasApplication({});
        }
      `,
    },
    ({ manifest }) => {
      assert.ok(
        auditArchitecture(manifest).some(
          ({ rule }) => rule === 'floating_operation_group',
        ),
      );
    },
  );
});

test('fitness rejects an operation group that is not composed into the central catalog', () => {
  withArchitectureFixture(
    {
      'product/application/conversation/isolated-operations.ts': `
        import { defineOperationGroup, type OperationDefinition } from '../atlas-application.ts';
        const isolated: OperationDefinition<'isolated.read', {}, {}, 'json'> = {
          descriptor: {
            key: 'isolated.read',
            resultKind: 'json',
            effect: 'read',
            validate: (input) => input,
          },
          async handle() { return {}; },
        };
        export function createIsolatedOperationGroup() {
          return defineOperationGroup({ 'isolated.read': isolated });
        }
      `,
    },
    ({ root, manifest }) => {
      const owner = path.join(
        root,
        'product/application/conversation/isolated-operations.ts',
      );
      const baseline = auditArchitecture(manifest);
      assert.ok(
        baseline.some(({ rule }) => rule === 'unowned_operation_group'),
      );

      const registered = auditArchitecture({
        ...manifest,
        isolatedOperationGroupOwners: {
          createIsolatedOperationGroup: owner,
        },
      });
      assert.ok(
        registered.some(
          ({ rule }) =>
            rule === 'unowned_operation_group' ||
            rule === 'unowned_operation_definition',
        ),
      );

      const wrongOwner = auditArchitecture({
        ...manifest,
        isolatedOperationGroupOwners: {
          createIsolatedOperationGroup: path.join(
            root,
            'product/application/sample-operations.ts',
          ),
        },
      });
      assert.ok(
        wrongOwner.some(({ rule }) => rule === 'unowned_operation_group'),
      );
    },
  );
});
test('fitness rejects an empty composed application catalog', () => {
  withArchitectureFixture(
    {
      'lib/server/application/server-atlas-application.ts': `
        import { createAtlasApplication } from '@/product/application/atlas-application';
        export function createServerAtlasApplication() {
          return createAtlasApplication({});
        }
      `,
    },
    ({ manifest }) => {
      assert.ok(
        auditArchitecture(manifest).some(
          ({ rule }) => rule === 'missing_composed_operation',
        ),
      );
    },
  );
});

test('fitness statically follows catalog and group identifiers', () => {
  withArchitectureFixture(
    {
      'lib/server/application/server-atlas-application.ts': `
        import { createSampleOperationGroup } from '@/product/application/sample-operations';
        import { createAtlasApplication } from '@/product/application/atlas-application';
        export function createServerAtlasApplication() {
          const sampleGroup = createSampleOperationGroup();
          const applicationCatalog = { ...sampleGroup };
          return createAtlasApplication(applicationCatalog);
        }
      `,
    },
    ({ manifest }) => assert.deepEqual(auditArchitecture(manifest), []),
  );
});

test('fitness resolves catalog identifiers by lexical symbol instead of file-wide name', () => {
  const shadowedCompositions = [
    `
      import { createSampleOperationGroup } from '@/product/application/sample-operations';
      import { createAtlasApplication } from '@/product/application/atlas-application';
      const applicationCatalog = { ...createSampleOperationGroup() };
      export function createServerAtlasApplication(
        applicationCatalog: unknown = {},
      ) {
        return createAtlasApplication(applicationCatalog);
      }
    `,
    `
      import { createSampleOperationGroup } from '@/product/application/sample-operations';
      import { createAtlasApplication } from '@/product/application/atlas-application';
      const applicationCatalog = { ...createSampleOperationGroup() };
      export function createServerAtlasApplication() {
        const applicationCatalog = {};
        return createAtlasApplication(applicationCatalog);
      }
    `,
    `
      import { createSampleOperationGroup } from '@/product/application/sample-operations';
      import { createAtlasApplication } from '@/product/application/atlas-application';
      export function createServerAtlasApplication() {
        const createSampleOperationGroup = () => ({});
        return createAtlasApplication({ ...createSampleOperationGroup() });
      }
    `,
    `
      import { createSampleOperationGroup } from '@/product/application/sample-operations';
      import { createAtlasApplication } from '@/product/application/atlas-application';
      const sampleGroup = createSampleOperationGroup();
      export function createServerAtlasApplication(sampleGroup: unknown = {}) {
        return createAtlasApplication({ ...sampleGroup });
      }
    `,
  ];
  for (const source of shadowedCompositions) {
    withArchitectureFixture(
      { 'lib/server/application/server-atlas-application.ts': source },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(({ rule }) =>
            [
              'dynamic_catalog_composition',
              'dynamic_catalog_spread',
              'missing_composed_operation',
            ].includes(rule),
          ),
          source,
        );
      },
    );
  }
});

test('fitness accepts a lexical top-level catalog alias chain', () => {
  withArchitectureFixture(
    {
      'lib/server/application/server-atlas-application.ts': `
        import { createSampleOperationGroup } from '@/product/application/sample-operations';
        import { createAtlasApplication } from '@/product/application/atlas-application';
        const sampleGroup = createSampleOperationGroup();
        const groupAlias = sampleGroup;
        const applicationCatalog = { ...groupAlias };
        const catalogAlias = applicationCatalog;
        export function createServerAtlasApplication() {
          return createAtlasApplication(catalogAlias);
        }
      `,
    },
    ({ manifest }) => assert.deepEqual(auditArchitecture(manifest), []),
  );
});

test('fitness rejects a local operation definition shadow inside a group', () => {
  withArchitectureFixture(
    {
      'product/application/sample-operations.ts': `
        import { defineOperationGroup, type OperationDefinition } from './atlas-application.ts';
        const sampleOperation: OperationDefinition<'sample.read', {}, {}, 'json'> = {
          descriptor: {
            key: 'sample.read',
            resultKind: 'json',
            effect: 'read',
            validate: (input) => input,
          },
          async handle() { return {}; },
        };
        const rogueOperation = { descriptor: { key: 'rogue.read', resultKind: 'json' } };
        export function createSampleOperationGroup() {
          const sampleOperation = rogueOperation;
          return defineOperationGroup({ 'sample.read': sampleOperation });
        }
      `,
    },
    ({ manifest }) => {
      assert.ok(
        auditArchitecture(manifest).some(
          ({ rule }) => rule === 'operation_group_map_mismatch',
        ),
      );
    },
  );
});

test('fitness accepts symmetric import and const alias chains for a group', () => {
  withArchitectureFixture(
    {
      'product/application/sample-operations.ts': `
        import {
          defineOperationGroup as defineGroup,
          type OperationDefinition,
        } from './atlas-application.ts';
        const sampleOperation: OperationDefinition<'sample.read', {}, {}, 'json'> = {
          descriptor: {
            key: 'sample.read',
            resultKind: 'json',
            effect: 'read',
            validate: (input) => input,
          },
          async handle() { return {}; },
        };
        const operationAlias = sampleOperation;
        export function createSampleOperationGroup() {
          const defineAlias = defineGroup;
          return defineAlias({ 'sample.read': operationAlias });
        }
      `,
      'lib/server/application/server-atlas-application.ts': `
        import { createSampleOperationGroup as importedGroup } from '@/product/application/sample-operations';
        import { createAtlasApplication } from '@/product/application/atlas-application';
        const groupFactory = importedGroup;
        const sampleGroup = groupFactory();
        const catalog = { ...sampleGroup };
        export function createServerAtlasApplication() {
          return createAtlasApplication(catalog);
        }
      `,
    },
    ({ manifest }) => assert.deepEqual(auditArchitecture(manifest), []),
  );
});

test('fitness rejects a local defineOperationGroup shadow', () => {
  withArchitectureFixture(
    {
      'product/application/sample-operations.ts': `
        import {
          defineOperationGroup,
          type OperationDefinition,
        } from './atlas-application.ts';
        const sampleOperation: OperationDefinition<'sample.read', {}, {}, 'json'> = {
          descriptor: {
            key: 'sample.read',
            resultKind: 'json',
            effect: 'read',
            validate: (input) => input,
          },
          async handle() { return {}; },
        };
        export function createSampleOperationGroup() {
          const defineOperationGroup = (value: unknown) => value;
          return defineOperationGroup({ 'sample.read': sampleOperation });
        }
      `,
    },
    ({ manifest }) => {
      assert.ok(
        auditArchitecture(manifest).some(
          ({ rule }) => rule === 'dynamic_operation_group',
        ),
      );
    },
  );
});

test('fitness fails closed on cyclic, mutable, and dynamic operation aliases', () => {
  const aliases = [
    `const operationAlias = nextAlias; const nextAlias = operationAlias;`,
    `let operationAlias = sampleOperation;`,
    `const operationAlias = chooseOperation(sampleOperation);`,
  ];
  for (const alias of aliases) {
    withArchitectureFixture(
      {
        'product/application/sample-operations.ts': `
          import { defineOperationGroup, type OperationDefinition } from './atlas-application.ts';
          const sampleOperation: OperationDefinition<'sample.read', {}, {}, 'json'> = {
            descriptor: {
              key: 'sample.read', resultKind: 'json', effect: 'read', validate: (input) => input,
            },
            async handle() { return {}; },
          };
          ${alias}
          export function createSampleOperationGroup() {
            return defineOperationGroup({ 'sample.read': operationAlias });
          }
        `,
      },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule }) => rule === 'operation_group_map_mismatch',
          ),
          alias,
        );
      },
    );
  }
});

test('fitness fails closed on cyclic, mutable, and dynamic group factory aliases', () => {
  const aliases = [
    `const groupFactory = nextFactory; const nextFactory = groupFactory;`,
    `let groupFactory = importedGroup;`,
    `const groupFactory = chooseFactory(importedGroup);`,
  ];
  for (const alias of aliases) {
    withArchitectureFixture(
      {
        'lib/server/application/server-atlas-application.ts': `
          import { createSampleOperationGroup as importedGroup } from '@/product/application/sample-operations';
          import { createAtlasApplication } from '@/product/application/atlas-application';
          ${alias}
          export function createServerAtlasApplication() {
            return createAtlasApplication({ ...groupFactory() });
          }
        `,
      },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(({ rule }) =>
            ['dynamic_catalog_spread', 'missing_composed_operation'].includes(
              rule,
            ),
          ),
          alias,
        );
      },
    );
  }
});

test('fitness fails closed on mutable and dynamic defineOperationGroup aliases', () => {
  for (const alias of [
    `let defineAlias = defineOperationGroup;`,
    `const defineAlias = chooseFactory(defineOperationGroup);`,
  ]) {
    withArchitectureFixture(
      {
        'product/application/sample-operations.ts': `
          import { defineOperationGroup, type OperationDefinition } from './atlas-application.ts';
          const sampleOperation: OperationDefinition<'sample.read', {}, {}, 'json'> = {
            descriptor: {
              key: 'sample.read', resultKind: 'json', effect: 'read', validate: (input) => input,
            },
            async handle() { return {}; },
          };
          export function createSampleOperationGroup() {
            ${alias}
            return defineAlias({ 'sample.read': sampleOperation });
          }
        `,
      },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule }) => rule === 'dynamic_operation_group',
          ),
          alias,
        );
      },
    );
  }
});

test('fitness rejects a dynamic catalog spread', () => {
  withArchitectureFixture(
    {
      'lib/server/application/server-atlas-application.ts': `
        import { createAtlasApplication } from '@/product/application/atlas-application';
        export function createServerAtlasApplication() {
          const dynamicCatalog = loadCatalog();
          return createAtlasApplication({ ...dynamicCatalog });
        }
      `,
    },
    ({ manifest }) => {
      assert.ok(
        auditArchitecture(manifest).some(
          ({ rule }) => rule === 'dynamic_catalog_spread',
        ),
      );
    },
  );
});

test('fitness rejects variable, indirect, and template HTTP mappings', () => {
  const mappingCopies = [
    `
      const key = 'demo';
      const method = 'GET';
      const path = '/api/demo';
      const bodyKind = 'none';
      export const duplicate = { demo: { key, method, path, bodyKind } };
    `,
    `
      const descriptor = ['demo', 'GET', '/api/demo', 'none'];
      export const duplicate = [descriptor];
    `,
    `
      export const duplicate = {
        demo: { key: 'demo', method: 'GET', path: \`/api/demo\`, bodyKind: 'none' },
      };
    `,
    `
      const duplicateRoutes: Record<string, {
        method: string;
        path: string;
        bodyKind: string;
      }> = {};
      export { duplicateRoutes };
    `,
    `
      export { browserOperationHttpCatalog } from './atlas-browser-operation-catalog';
    `,
  ];
  const detected = [];
  for (const source of mappingCopies) {
    withArchitectureFixture(
      { 'features/atlas/second-mapping.ts': source },
      ({ manifest }) => {
        detected.push(
          auditArchitecture(manifest).some(
            ({ rule }) => rule === 'mapping_declaration_outside_owner',
          ),
        );
      },
    );
  }
  assert.deepEqual(detected, [true, true, true, true, true]);
});

test('fitness rejects an extra Browser mapping consumer', () => {
  withArchitectureFixture(
    {
      'features/atlas/extra-consumer.ts': `
        import { browserOperationHttpCatalog as copiedCatalog } from './atlas-browser-operation-catalog';
        void copiedCatalog;
      `,
    },
    ({ manifest }) => {
      assert.ok(
        auditArchitecture(manifest).some(
          ({ rule }) => rule === 'second_mapping_consumer',
        ),
      );
    },
  );
});

test('fitness follows the exported server factory binding instead of a decoy catalog', () => {
  withArchitectureFixture(
    {
      'lib/server/application/server-atlas-application.ts': `
        import { createSampleOperationGroup } from '@/product/application/sample-operations';
        import {
          createAtlasApplication,
          createAtlasApplication as makeApplication,
        } from '@/product/application/atlas-application';
        function decoyApplication() {
          return createAtlasApplication({ ...createSampleOperationGroup() });
        }
        void decoyApplication;
        export function createServerAtlasApplication() {
          return makeApplication({});
        }
      `,
    },
    ({ manifest }) => {
      const rules = auditArchitecture(manifest).map(({ rule }) => rule);
      assert.ok(rules.includes('decoy_application_factory'));
      assert.ok(rules.includes('missing_composed_operation'));
    },
  );
});

test('fitness rejects namespace, dynamic, and non-static server factory composition', () => {
  const cases = [
    `
      import * as atlasFactory from '@/product/application/atlas-application';
      import { createSampleOperationGroup } from '@/product/application/sample-operations';
      export function createServerAtlasApplication() {
        return atlasFactory.createAtlasApplication({ ...createSampleOperationGroup() });
      }
    `,
    `
      import { createSampleOperationGroup } from '@/product/application/sample-operations';
      export async function createServerAtlasApplication() {
        const atlasFactory = await import('@/product/application/atlas-application');
        return atlasFactory.createAtlasApplication({ ...createSampleOperationGroup() });
      }
    `,
    `
      import { createAtlasApplication } from '@/product/application/atlas-application';
      import { createSampleOperationGroup } from '@/product/application/sample-operations';
      export function createServerAtlasApplication(enabled: boolean) {
        return enabled
          ? createAtlasApplication({ ...createSampleOperationGroup() })
          : createAtlasApplication({});
      }
    `,
    `
      import { createAtlasApplication } from '@/product/application/atlas-application';
      import { createSampleOperationGroup } from '@/product/application/sample-operations';
      export function createServerAtlasApplication(
        createAtlasApplication = (catalog: unknown) => catalog,
      ) {
        return createAtlasApplication({ ...createSampleOperationGroup() });
      }
    `,
  ];
  for (const source of cases) {
    withArchitectureFixture(
      { 'lib/server/application/server-atlas-application.ts': source },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(({ rule }) =>
            [
              'unsupported_application_factory_binding',
              'nonstatic_server_factory_return',
            ].includes(rule),
          ),
          source,
        );
      },
    );
  }
});

test('fitness recognizes every unsupported shared mapping consumer form', () => {
  const consumers = [
    `import * as mapping from './atlas-browser-operation-catalog'; void mapping;`,
    `const mapping = import('./atlas-browser-operation-catalog'); void mapping;`,
    `import mapping = require('./atlas-browser-operation-catalog'); void mapping;`,
    `const mapping = require('./atlas-browser-operation-catalog'); void mapping;`,
  ];
  for (const source of consumers) {
    withArchitectureFixture(
      { 'features/atlas/extra-consumer.ts': source },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule }) => rule === 'second_mapping_consumer',
          ),
          source,
        );
      },
    );
  }
});

test('fitness rejects direct and indirectly assembled HTTP mappings in allowed consumers', () => {
  const sources = [
    `
      import { browserOperationHttpCatalog } from './atlas-browser-operation-catalog';
      const rogue = \`/api/rogue\`;
      void browserOperationHttpCatalog;
      void rogue;
    `,
    `
      import { browserOperationHttpCatalog } from './atlas-browser-operation-catalog';
      const descriptor = ['G' + 'ET', '/api/' + 'rogue', 'no' + 'ne'];
      void browserOperationHttpCatalog;
      void descriptor;
    `,
  ];
  for (const source of sources) {
    withArchitectureFixture(
      { 'features/atlas/use-atlas-webmcp.ts': source },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule }) => rule === 'consumer_http_mapping',
          ),
          source,
        );
      },
    );
  }
});

test('fitness catches renamed copies of the three policy primitives', () => {
  withArchitectureFixture(
    {
      'features/atlas/renamed-search.ts': `
        export function lookup(item: { title: string }, query: string) {
          const tokens = query.trim().split(/\\s+/u).filter(Boolean);
          return tokens.every((token) => item.title.normalize('NFKC').includes(token));
        }
      `,
      'features/atlas/renamed-rating.ts': `
        export const roundScore = (value: number) => Math.round((value + Number.EPSILON) * 10) / 10;
      `,
      'features/atlas/renamed-visited.ts': `
        export function visible(marked: boolean, count: number) {
          return Boolean(marked) || count > 0;
        }
      `,
    },
    ({ manifest }) => {
      const details = auditArchitecture(manifest)
        .filter(({ rule }) => rule === 'duplicate_business_policy')
        .map(({ detail }) => detail);
      assert.ok(details.some((detail) => detail.includes('search')));
      assert.ok(details.some((detail) => detail.includes('rating')));
      assert.ok(details.some((detail) => detail.includes('effectiveVisited')));
    },
  );
});

test('fitness catches reviewer variants of rating, visited, and search policies', () => {
  withArchitectureFixture(
    {
      'features/atlas/reviewer-rating.ts': `
        export const displayScore = (value: number) => Number(value.toFixed(1));
      `,
      'features/atlas/reviewer-visited.ts': `
        export function visible(marked: boolean, count: number) {
          return marked ? true : count > 0;
        }
      `,
      'features/atlas/reviewer-search.ts': `
        export function lookup(item: { title: string }, query: string) {
          return item.title.toLowerCase().includes(query.toLowerCase());
        }
      `,
    },
    ({ manifest }) => {
      const details = auditArchitecture(manifest)
        .filter(({ rule }) => rule === 'duplicate_business_policy')
        .map(({ detail }) => detail);
      assert.ok(details.some((detail) => detail.includes('rating')));
      assert.ok(details.some((detail) => detail.includes('effectiveVisited')));
      assert.ok(details.some((detail) => detail.includes('search')));
    },
  );
});

test('fitness catches common renamed rating round-to-tenth equivalents', () => {
  for (const source of [
    `export const score = (value: number) => Number(value.toFixed(1));`,
    `export const score = (value: number) => Math.floor(value * 10 + 0.5) / 10;`,
  ]) {
    withArchitectureFixture(
      { 'features/atlas/another-rating.ts': source },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule, detail }) =>
              rule === 'duplicate_business_policy' && detail.includes('rating'),
          ),
          source,
        );
      },
    );
  }
});

test('fitness catches conditional, if, and Boolean effective-visited equivalents', () => {
  for (const source of [
    `export const visited = (marked: boolean, count: number) => marked ? true : count > 0;`,
    `export function visited(marked: boolean, count: number) { if (marked) return true; return count > 0; }`,
    `export const visited = (marked: boolean, count: number) => Boolean(marked || count);`,
  ]) {
    withArchitectureFixture(
      { 'features/atlas/another-visited.ts': source },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule, detail }) =>
              rule === 'duplicate_business_policy' &&
              detail.includes('effectiveVisited'),
          ),
          source,
        );
      },
    );
  }
});

test('fitness catches lowercase match and segment search pipelines', () => {
  for (const source of [
    `export const match = (text: string, query: string) => text.toLowerCase().includes(query.toLowerCase());`,
    `export const match = (values: string[], query: string) => values.some((value) => value.toLocaleLowerCase() === query);`,
    `export const match = (segmenter: Intl.Segmenter, text: string) => [...segmenter.segment(text.toLowerCase())];`,
  ]) {
    withArchitectureFixture(
      { 'features/atlas/another-search.ts': source },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule, detail }) =>
              rule === 'duplicate_business_policy' && detail.includes('search'),
          ),
          source,
        );
      },
    );
  }
});

test('fitness constrains compatibility adapters structurally', () => {
  withArchitectureFixture(
    {
      'features/atlas/search.ts': `export function localSearch() { return true; }`,
    },
    ({ manifest }) => {
      const rules = auditArchitecture(manifest).map(({ rule }) => rule);
      assert.ok(rules.includes('compatibility_adapter_shape'));
    },
  );
});

test('fitness rejects side effects in the rating parse adapter', () => {
  for (const statement of [
    'console.log(value);',
    'void fetch(value);',
    'globalThis.lastRating = value;',
  ]) {
    withArchitectureFixture(
      {
        'features/atlas/rating.ts': `
          import { normalizeAssessmentRating } from '../../product/application/assessments/assessment-rating.ts';
          export { normalizeAssessmentRating as normalizeRating } from '../../product/application/assessments/assessment-rating.ts';
          export function parseOptionalRating(value: string) {
            ${statement}
            const trimmed = value.trim();
            return trimmed === '' ? undefined : normalizeAssessmentRating(Number(trimmed));
          }
        `,
      },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule }) => rule === 'compatibility_adapter_shape',
          ),
          statement,
        );
      },
    );
  }
});

test('fitness rejects bare side-effect imports in every compatibility adapter', () => {
  const cases = [
    {
      file: 'features/atlas/search.ts',
      source: `
        import '../../product/application/decision/search-policy.ts';
        export { matchesAtlasQuery } from '../../product/application/decision/search-policy.ts';
      `,
    },
    {
      file: 'features/atlas/rating.ts',
      source: `
        import '../../product/application/assessments/assessment-rating.ts';
        import { normalizeAssessmentRating } from '../../product/application/assessments/assessment-rating.ts';
        export { normalizeAssessmentRating as normalizeRating } from '../../product/application/assessments/assessment-rating.ts';
        export function parseOptionalRating(value: string) {
          const trimmed = value.trim();
          return trimmed === '' ? undefined : normalizeAssessmentRating(Number(trimmed));
        }
      `,
    },
    {
      file: 'features/atlas/model.ts',
      source: `
        import '../../product/application/core-model.ts';
        import type { AtlasItem as CoreAtlasItem } from '../../product/application/core-model.ts';
        export type AtlasItem = CoreAtlasItem;
      `,
    },
  ];
  for (const { file, source } of cases) {
    withArchitectureFixture({ [file]: source }, ({ manifest }) => {
      assert.ok(
        auditArchitecture(manifest).some(
          ({ rule }) => rule === 'compatibility_adapter_shape',
        ),
        file,
      );
    });
  }
});

test('fitness rejects non-named and non-owner compatibility module forms', () => {
  const cases = [
    {
      file: 'features/atlas/search.ts',
      source: `
        import * as searchPolicy from '../../product/application/decision/search-policy.ts';
        export { matchesAtlasQuery } from '../../product/application/decision/search-policy.ts';
      `,
    },
    {
      file: 'features/atlas/search.ts',
      source: `
        void import('../../product/application/decision/search-policy.ts');
        export { matchesAtlasQuery } from '../../product/application/decision/search-policy.ts';
      `,
    },
    {
      file: 'features/atlas/search.ts',
      source: `export * from '../../product/application/decision/search-policy.ts';`,
    },
    {
      file: 'features/atlas/rating.ts',
      source: `
        import normalizeAssessmentRating from '../../product/application/assessments/assessment-rating.ts';
        export { normalizeAssessmentRating as normalizeRating } from '../../product/application/assessments/assessment-rating.ts';
        export function parseOptionalRating(value: string) {
          const trimmed = value.trim();
          return trimmed === '' ? undefined : normalizeAssessmentRating(Number(trimmed));
        }
      `,
    },
    {
      file: 'features/atlas/model.ts',
      source: `
        import type { Extra } from '../../product/application/extra-model.ts';
        import type { AtlasItem as CoreAtlasItem } from '../../product/application/core-model.ts';
        export type AtlasItem = CoreAtlasItem;
      `,
      extra: {
        'product/application/extra-model.ts': `export interface Extra { readonly id: string }`,
      },
    },
  ];
  for (const { file, source, extra = {} } of cases) {
    withArchitectureFixture({ ...extra, [file]: source }, ({ manifest }) => {
      assert.ok(
        auditArchitecture(manifest).some(
          ({ rule }) => rule === 'compatibility_adapter_shape',
        ),
        source,
      );
    });
  }
});

test('fitness rejects compatibility dependencies with top-level side effects', () => {
  withArchitectureFixture(
    {
      'product/application/decision/search-policy.ts': `
        console.log('unexpected initialization');
        export function matchesAtlasQuery() { return true; }
      `,
    },
    ({ manifest }) => {
      assert.ok(
        auditArchitecture(manifest).some(
          ({ rule }) => rule === 'compatibility_adapter_dependency_effect',
        ),
      );
    },
  );
});

test('fitness detects eager effects hidden in initializers and class static paths', () => {
  const effects = [
    `const initialized = (globalThis.flag = true);`,
    `let counter = 0; const initialized = counter++;`,
    `const initialized = new Date();`,
    `const initialized = touch();`,
    `const initialized = await pendingValue;`,
    `const initialized = tag\`touch\`;`,
    `const initialized = (() => { globalThis.flag = true; })();`,
    `class StaticBlock { static { globalThis.flag = true; } }`,
    `const StaticExpression = class { static { globalThis.flag = true; } };`,
    `class StaticInitializer { static value = touch(); }`,
    `class ComputedInitializer { static [touch()] = 1; }`,
  ];
  for (const effect of effects) {
    withArchitectureFixture(
      {
        'product/application/decision/search-policy.ts': `
          ${effect}
          export function matchesAtlasQuery() { return true; }
        `,
      },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule }) => rule === 'compatibility_adapter_dependency_effect',
          ),
          effect,
        );
      },
    );
  }
});

test('fitness allows pure data and lazy definitions in compatibility owners', () => {
  withArchitectureFixture(
    {
      'product/application/decision/search-policy.ts': `
        const pureData = { labels: ['food', 'event'], enabled: true };
        const lazyArrow = () => touch();
        class LazyClass {
          static label = 'lazy';
          instanceValue = touch();
          method() { return touch(); }
        }
        export function matchesAtlasQuery() { return true; }
      `,
    },
    ({ manifest }) => {
      assert.ok(
        !auditArchitecture(manifest).some(
          ({ rule }) => rule === 'compatibility_adapter_dependency_effect',
        ),
      );
    },
  );
});

test('fitness treats both pure type re-export forms as runtime erased', () => {
  for (const reexport of [
    `export { type Foo } from './allowed-owner.ts';`,
    `export type { Foo } from './allowed-owner.ts';`,
  ]) {
    withArchitectureFixture(
      {
        'product/application/decision/allowed-owner.ts': `export interface Foo { readonly id: string }`,
        'product/application/decision/search-policy.ts': `
          ${reexport}
          export function matchesAtlasQuery() { return true; }
        `,
      },
      ({ manifest }) => {
        assert.ok(
          !auditArchitecture(manifest).some(
            ({ rule }) => rule === 'compatibility_adapter_dependency_effect',
          ),
          reexport,
        );
      },
    );
  }
});

test('fitness accepts individually type-only model adapter re-exports', () => {
  withArchitectureFixture(
    {
      'features/atlas/model.ts': `
        import type { AtlasItem as CoreAtlasItem } from '../../product/application/core-model.ts';
        export type AtlasItem = CoreAtlasItem;
        export {
          type ImportJob,
          type ImportStatus,
          type NewImportJob,
        } from '../../product/application/core-model.ts';
      `,
    },
    ({ manifest }) => assert.deepEqual(auditArchitecture(manifest), []),
  );
});

test('fitness keeps mixed and runtime re-exports eager', () => {
  for (const reexport of [
    `export { type Foo, runtimeValue } from './allowed-owner.ts';`,
    `export { runtimeValue } from './allowed-owner.ts';`,
    `export * from './allowed-owner.ts';`,
  ]) {
    withArchitectureFixture(
      {
        'product/application/decision/allowed-owner.ts': `
          export interface Foo { readonly id: string }
          export const runtimeValue = 1;
          globalThis.allowedOwnerLoaded = true;
        `,
        'product/application/decision/search-policy.ts': `
          ${reexport}
          export function matchesAtlasQuery() { return true; }
        `,
      },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule }) => rule === 'compatibility_adapter_dependency_effect',
          ),
          reexport,
        );
      },
    );
  }
});

test('fitness follows named and mixed runtime imports to eager dependencies', () => {
  const cases = [
    {
      dependency: `
        export const helper = 1;
        globalThis.dependencyLoaded = true;
      `,
      owner: `
        import { helper as localHelper } from './runtime-helper.ts';
        export function matchesAtlasQuery() { return localHelper === 1; }
      `,
    },
    {
      dependency: `
        export interface HelperOptions { readonly enabled: boolean }
        export const helper = (() => 1)();
      `,
      owner: `
        import { type HelperOptions, helper as localHelper } from './runtime-helper.ts';
        export function matchesAtlasQuery() {
          const options: HelperOptions = { enabled: true };
          return options.enabled && localHelper === 1;
        }
      `,
    },
    {
      dependency: `
        export class Helper {
          static { globalThis.dependencyLoaded = true; }
        }
      `,
      owner: `
        import { Helper as LocalHelper } from './runtime-helper.ts';
        export function matchesAtlasQuery() { return Boolean(LocalHelper); }
      `,
    },
  ];

  for (const { dependency, owner } of cases) {
    withArchitectureFixture(
      {
        'product/application/decision/runtime-helper.ts': dependency,
        'product/application/decision/search-policy.ts': owner,
      },
      ({ manifest }) => {
        const violation = auditArchitecture(manifest).find(
          ({ rule, file }) =>
            rule === 'compatibility_adapter_dependency_effect' &&
            file === 'product/application/decision/search-policy.ts',
        );
        assert.ok(violation, dependency);
        assert.equal(violation.detail, 'search:top-level-effect');
        assert.doesNotMatch(violation.detail, /atlas-fitness-/u);
      },
    );
  }
});

test('fitness follows runtime re-export chains transitively', () => {
  withArchitectureFixture(
    {
      'product/application/decision/runtime-leaf.ts': `
        globalThis.dependencyLoaded = true;
        export const helper = 1;
      `,
      'product/application/decision/runtime-helper.ts': `
        export { helper as searchHelper } from './runtime-leaf.ts';
      `,
      'product/application/decision/search-policy.ts': `
        export { searchHelper } from './runtime-helper.ts';
        export function matchesAtlasQuery() { return true; }
      `,
    },
    ({ manifest }) => {
      const violation = auditArchitecture(manifest).find(
        ({ rule, file }) =>
          rule === 'compatibility_adapter_dependency_effect' &&
          file === 'product/application/decision/search-policy.ts',
      );
      assert.ok(violation);
      assert.equal(violation.detail, 'search:top-level-effect');
    },
  );
});

test('fitness skips declaration-level and specifier-level type-only imports', () => {
  withArchitectureFixture(
    {
      'product/application/decision/type-helper.ts': `
        globalThis.mustNotBeLoaded = true;
        export interface FirstType { readonly first: true }
        export interface SecondType { readonly second: true }
      `,
      'product/application/decision/search-policy.ts': `
        import type { FirstType } from './type-helper.ts';
        import { type SecondType } from './type-helper.ts';
        export function matchesAtlasQuery() {
          const first: FirstType = { first: true };
          const second: SecondType = { second: true };
          return first.first && second.second;
        }
      `,
    },
    ({ manifest }) => {
      assert.ok(
        !auditArchitecture(manifest).some(
          ({ rule }) => rule === 'compatibility_adapter_dependency_effect',
        ),
      );
    },
  );
});

test('fitness fails closed for unresolved, nonlocal, and cyclic runtime dependencies', () => {
  const cases = [
    {
      files: {},
      owner: `
        import { helper } from './missing-helper.ts';
        export function matchesAtlasQuery() { return helper(); }
      `,
      reason: 'unresolved',
    },
    {
      files: {},
      owner: `
        import { helper } from 'unapproved-runtime-package';
        export function matchesAtlasQuery() { return helper(); }
      `,
      reason: 'nonlocal',
    },
    {
      files: {
        'product/application/decision/runtime-helper.ts': `
          import { matchesAtlasQuery } from './search-policy.ts';
          export function helper() { return matchesAtlasQuery(); }
        `,
      },
      owner: `
        import { helper } from './runtime-helper.ts';
        export function matchesAtlasQuery() { return helper(); }
      `,
      reason: 'cycle',
    },
  ];
  for (const { files, owner, reason } of cases) {
    withArchitectureFixture(
      {
        ...files,
        'product/application/decision/search-policy.ts': owner,
      },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule, detail }) =>
              rule === 'compatibility_adapter_dependency_effect' &&
              detail.includes(`:${reason}`),
          ),
          reason,
        );
      },
    );
  }
});

test('fitness audits the unadapted effective-visited policy owner', () => {
  withArchitectureFixture(
    {
      'product/application/assessments/effective-helper.ts': `
        export const loaded = (() => true)();
      `,
      'product/application/assessments/effective-visited.ts': `
        import { loaded } from './effective-helper.ts';
        export function isEffectivelyVisited() { return loaded; }
      `,
    },
    ({ manifest }) => {
      assert.ok(
        auditArchitecture(manifest).some(
          ({ rule, detail }) =>
            rule === 'compatibility_adapter_dependency_effect' &&
            detail.startsWith('effectiveVisited:') &&
            detail.endsWith('top-level-effect'),
        ),
      );
    },
  );
});

test('fitness rejects unapproved declarations in the UI model adapter', () => {
  for (const declaration of [
    `export interface HiddenDomainRecord { readonly secret: string }`,
    `export type AtlasItem = { readonly disguisedDuplicate: string };`,
  ]) {
    withArchitectureFixture(
      {
        'features/atlas/model.ts': `
          import type { AtlasItem as CoreAtlasItem } from '../../product/application/core-model.ts';
          ${declaration.includes('AtlasItem') ? '' : 'export type AtlasItem = CoreAtlasItem;'}
          ${declaration}
        `,
      },
      ({ manifest }) => {
        assert.ok(
          auditArchitecture(manifest).some(
            ({ rule }) => rule === 'compatibility_adapter_shape',
          ),
          declaration,
        );
      },
    );
  }
});

test('fitness permits only the exact AtlasItem UI projection', () => {
  for (const projection of [
    'CoreAtlasItem',
    'CoreAtlasItem & { readonly overallComment?: string; }',
  ]) {
    withArchitectureFixture(
      {
        'features/atlas/model.ts': `
        import type { AtlasItem as CoreAtlasItem } from '../../product/application/core-model.ts';
        export type AtlasItem = ${projection};
      `,
      },
      ({ manifest }) => {
        const violations = auditArchitecture(manifest);
        assert.equal(
          violations.some(({ rule }) => rule === 'duplicate_core_model'),
          false,
        );
        assert.equal(
          violations.some(({ rule }) => rule === 'compatibility_adapter_shape'),
          false,
        );
      },
    );
  }
});

test('fitness rejects a core record type literal in the feature adapter', () => {
  for (const projection of [
    `{ readonly id: string }`,
    `CoreAtlasItem & { readonly overallComment?: string; readonly extra?: string }`,
  ]) {
    withArchitectureFixture(
      {
        'features/atlas/model.ts': `
          import type { AtlasItem as CoreAtlasItem } from '../../product/application/core-model.ts';
          export type AtlasItem = ${projection};
        `,
      },
      ({ manifest }) => {
        const rules = new Set(
          auditArchitecture(manifest).map(({ rule }) => rule),
        );
        assert.ok(rules.has('duplicate_core_model'), projection);
        assert.ok(rules.has('compatibility_adapter_shape'), projection);
      },
    );
  }
});

const expectedOperationKeys = [
  'assessment.display',
  'assessment.update',
  'nearby.recommend',
  'catalog.delete_item',
  'catalog.get',
  'catalog.list',
  'catalog.save_discovered',
  'catalog.search',
  'catalog.update_item',
  'decision.nearby',
  'import.delete',
  'import.list',
  'import.queue',
  'media.attach',
  'media.caption',
  'media.delete',
  'media.list',
  'media.open',
  'media.openDisplay',
  'visit.create',
  'visit.delete',
  'visit.getDisplay',
  'visit.list',
  'visit.listDisplay',
  'visit.update',
];

const expectedOperationGroupCreators = [
  'createImportJobOperationGroup',
  'createCatalogOperationGroup',
  'createPlaceAssessmentOperationGroup',
  'createPublicDisplayOperationGroup',
  'createDecisionOperationGroup',
  'createVisitOperationGroup',
  'createNearbyRecommendationOperationGroup',
  'createDestructiveOperationGroup',
  'createMediaOperationGroup',
];

function productionCoreModelOwners() {
  const owner = (relative) =>
    path.join(webRoot, 'product/application', relative);
  return {
    AtlasItemKind: owner('catalog/atlas-item.ts'),
    AtlasItem: owner('catalog/atlas-item.ts'),
    AtlasItemEdit: owner('catalog/atlas-item.ts'),
    PersonalState: owner('catalog/atlas-item.ts'),
    VerificationStatus: owner('catalog/atlas-item.ts'),
    ReservationMode: owner('catalog/atlas-item.ts'),
    SourceLink: owner('catalog/atlas-item.ts'),
    TabelogSnapshot: owner('catalog/atlas-item.ts'),
    ReservationSnapshot: owner('catalog/atlas-item.ts'),
    EventSchedule: owner('catalog/atlas-item.ts'),
    PlaceAssessment: owner('assessments/place-assessment.ts'),
    PlaceAssessmentPatch: owner('assessments/place-assessment.ts'),
    ImportJob: owner('import-jobs/import-job.ts'),
    ImportStatus: owner('import-jobs/import-job.ts'),
    NewImportJob: owner('import-jobs/import-job.ts'),
    VisitRecord: owner('visits/visit.ts'),
    VisitMediaRecord: owner('media/visit-media.ts'),
    NewVisit: owner('visits/visit.ts'),
    VisitUpdate: owner('visits/visit.ts'),
    VisitCreateResult: owner('visits/visit.ts'),
    VisitMutationResult: owner('visits/visit.ts'),
  };
}

function productionArchitectureManifest() {
  return {
    webRoot,
    productionRoots: [
      'app',
      'components',
      'db',
      'features',
      'lib',
      'product',
    ].map((directory) => path.join(webRoot, directory)),
    productRoot,
    apiRoot,
    compositionRoot: path.join(
      webRoot,
      'lib/server/application/server-atlas-application.ts',
    ),
    applicationFactoryFile: path.join(
      webRoot,
      'product/application/atlas-application.ts',
    ),
    browserMappingFile: path.join(
      webRoot,
      'features/atlas/atlas-browser-operation-catalog.ts',
    ),
    browserClientFile: path.join(webRoot, 'features/atlas/atlas-api-client.ts'),
    webMcpFile: path.join(webRoot, 'features/atlas/use-atlas-webmcp.ts'),
    capabilitiesFile: path.join(webRoot, 'app/api/agent/capabilities/route.ts'),
    uiCompatibilityModelFile: path.join(webRoot, 'features/atlas/model.ts'),
    expectedCoreModelAliases: coreModelAliases,
    coreModelOwners: productionCoreModelOwners(),
    compatibilityAdapters: {
      search: path.join(webRoot, 'features/atlas/search.ts'),
      rating: path.join(webRoot, 'features/atlas/rating.ts'),
      model: path.join(webRoot, 'features/atlas/model.ts'),
    },
    retiredFiles: [
      'lib/server/atlas-store.ts',
      'lib/server/media-store.ts',
      'lib/server/journal-write.ts',
      'lib/server/journal-write.test.mjs',
      'lib/server/media-policy.ts',
      'lib/server/media-policy.test.mjs',
      'features/atlas/distance.ts',
    ],
    expectedOperationKeys,
    expectedMediaOperationKeys: ['media.open', 'media.openDisplay'],
    expectedOperationGroupCreators,
    businessPolicyOwners: {
      search: path.join(
        webRoot,
        'product/application/decision/search-policy.ts',
      ),
      rating: path.join(
        webRoot,
        'product/application/assessments/assessment-rating.ts',
      ),
      effectiveVisited: path.join(
        webRoot,
        'product/application/assessments/effective-visited.ts',
      ),
    },
  };
}

function withArchitectureFixture(overrides, assertion) {
  const root = mkdtempSync(path.join(tmpdir(), 'atlas-fitness-'));
  try {
    const files = {
      'product/application/sample-operations.ts': sampleOperation("'", "'"),
      'product/application/atlas-application.ts': `
        export function defineOperationGroup(value: unknown) { return value; }
        export function createAtlasApplication(value: unknown) { return value; }
        export type OperationDefinition<Key, Input, Output, Kind> = unknown;
      `,
      'lib/server/application/server-atlas-application.ts': `
        import { createSampleOperationGroup } from '@/product/application/sample-operations';
        import { createAtlasApplication } from '@/product/application/atlas-application';
        export function createServerAtlasApplication() {
          return createAtlasApplication({ ...createSampleOperationGroup() });
        }
      `,
      'features/atlas/atlas-browser-operation-catalog.ts': `
        export const mapping = defineBrowserOperationHttpCatalog({
          sample: { key: 'sample.read', method: 'GET', path: '/api/sample', bodyKind: 'none' },
        });
        export function createAgentCapabilitiesDocument() { return { operations: [] }; }
      `,
      'features/atlas/atlas-api-client.ts': `import { browserOperationHttpCatalog } from './atlas-browser-operation-catalog'; void browserOperationHttpCatalog;`,
      'features/atlas/use-atlas-webmcp.ts': `import { browserOperationHttpCatalog } from './atlas-browser-operation-catalog.ts'; void browserOperationHttpCatalog;`,
      'product/application/core-model.ts': `export interface AtlasItem { readonly id: string }`,
      'product/application/decision/search-policy.ts': `export function matchesAtlasQuery() { return true; }`,
      'product/application/assessments/assessment-rating.ts': `export function normalizeAssessmentRating(value: number) { return value; }`,
      'features/atlas/model.ts': `
        import type { AtlasItem as CoreAtlasItem } from '../../product/application/core-model.ts';
        export type AtlasItem = CoreAtlasItem;
      `,
      'features/atlas/search.ts': `export { matchesAtlasQuery } from '../../product/application/decision/search-policy.ts';`,
      'features/atlas/rating.ts': `
        import { normalizeAssessmentRating } from '../../product/application/assessments/assessment-rating.ts';
        export { normalizeAssessmentRating as normalizeRating } from '../../product/application/assessments/assessment-rating.ts';
        export function parseOptionalRating(value: string) {
          const trimmed = value.trim();
          return trimmed === '' ? undefined : normalizeAssessmentRating(Number(trimmed));
        }
      `,
      'app/api/agent/capabilities/route.ts': `import { createAgentCapabilitiesDocument } from '@/features/atlas/atlas-browser-operation-catalog'; void createAgentCapabilitiesDocument;`,
      'app/api/sample/route.ts': `export function GET() { return new Response('ok'); }`,
      ...overrides,
    };
    for (const [relative, source] of Object.entries(files)) {
      const filename = path.join(root, relative);
      mkdirSync(path.dirname(filename), { recursive: true });
      writeFileSync(filename, source);
    }
    const manifest = {
      webRoot: root,
      productionRoots: ['app', 'features', 'lib', 'product'].map((directory) =>
        path.join(root, directory),
      ),
      productRoot: path.join(root, 'product'),
      apiRoot: path.join(root, 'app/api'),
      compositionRoot: path.join(
        root,
        'lib/server/application/server-atlas-application.ts',
      ),
      applicationFactoryFile: path.join(
        root,
        'product/application/atlas-application.ts',
      ),
      browserMappingFile: path.join(
        root,
        'features/atlas/atlas-browser-operation-catalog.ts',
      ),
      browserClientFile: path.join(root, 'features/atlas/atlas-api-client.ts'),
      webMcpFile: path.join(root, 'features/atlas/use-atlas-webmcp.ts'),
      capabilitiesFile: path.join(root, 'app/api/agent/capabilities/route.ts'),
      uiCompatibilityModelFile: path.join(root, 'features/atlas/model.ts'),
      expectedCoreModelAliases: coreModelAliases,
      coreModelOwners: Object.fromEntries(
        coreModelAliases.map((name) => [
          name,
          path.join(root, 'product/application/core-model.ts'),
        ]),
      ),
      compatibilityAdapters: {
        search: path.join(root, 'features/atlas/search.ts'),
        rating: path.join(root, 'features/atlas/rating.ts'),
        model: path.join(root, 'features/atlas/model.ts'),
      },
      retiredFiles: [],
      expectedOperationKeys: ['sample.read'],
      expectedMediaOperationKeys: [],
      expectedOperationGroupCreators: ['createSampleOperationGroup'],
      businessPolicyOwners: {
        search: path.join(
          root,
          'product/application/decision/search-policy.ts',
        ),
        rating: path.join(
          root,
          'product/application/assessments/assessment-rating.ts',
        ),
        effectiveVisited: path.join(
          root,
          'product/application/assessments/effective-visited.ts',
        ),
      },
    };
    assertion({ root, manifest });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function sampleOperation(keyQuote, kindQuote) {
  return `
    import { defineOperationGroup, type OperationDefinition } from './atlas-application.ts';
    const sampleOperation: OperationDefinition<${keyQuote}sample.read${keyQuote}, {}, {}, ${kindQuote}json${kindQuote}> = {
      descriptor: {
        key: ${keyQuote}sample.read${keyQuote},
        resultKind: ${kindQuote}json${kindQuote},
        effect: 'read',
        validate: (input) => input,
      },
      async handle() { return {}; },
    };
    export function createSampleOperationGroup() {
      return defineOperationGroup({ 'sample.read': sampleOperation });
    }
  `;
}
