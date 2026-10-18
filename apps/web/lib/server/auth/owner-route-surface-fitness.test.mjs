import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const apiRoot = fileURLToPath(new URL('../../../app/api/', import.meta.url));
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const closedRouteSurface = [
  route('agent/catalog-intake/route.ts', ['POST'], 'add_agent_token'),
  route('auth/owner/route.ts', ['DELETE', 'POST'], 'owner_auth'),
  route('catalog-intake/cancel/route.ts', ['POST'], 'owner_cookie'),
  route('catalog-intake/confirm/route.ts', ['POST'], 'owner_cookie'),
  route('catalog-intake/discover/route.ts', ['POST'], 'owner_cookie'),
  route('catalog-intake/select/route.ts', ['POST'], 'owner_cookie'),
  route(
    'items/[id]/google-rating-reference/route.ts',
    ['POST'],
    'owner_cookie',
  ),
  route('items/[id]/personal/route.ts', ['PATCH'], 'owner_cookie'),
  route('items/[id]/route.ts', ['DELETE', 'PATCH'], 'owner_cookie'),
  route('items/route.ts', ['POST'], 'owner_cookie'),
  route('journal/[id]/route.ts', ['DELETE', 'PATCH'], 'owner_cookie'),
  route('journal/route.ts', ['POST'], 'owner_cookie'),
  route('media/[id]/route.ts', ['DELETE', 'PATCH'], 'owner_cookie'),
  route('media/route.ts', ['POST'], 'owner_cookie'),
  route('owner/agent-settings/route.ts', ['DELETE', 'PUT'], 'owner_cookie'),
  route('recommend/route.ts', ['POST'], 'owner_cookie'),
];

const ownerPocBusinessWriteSurface = [
  ownerPocRoute(
    'agent/catalog-intake/route.ts',
    ['POST'],
    'add_agent_operation',
  ),
  ownerPocRoute(
    'catalog-intake/cancel/route.ts',
    ['POST'],
    'application_operation',
  ),
  ownerPocRoute(
    'catalog-intake/confirm/route.ts',
    ['POST'],
    'application_operation',
  ),
  ownerPocRoute(
    'catalog-intake/discover/route.ts',
    ['POST'],
    'application_operation',
  ),
  ownerPocRoute(
    'catalog-intake/select/route.ts',
    ['POST'],
    'application_operation',
  ),
  ownerPocRoute('items/[id]/personal/route.ts', ['PATCH'], 'coordinator'),
  ownerPocRoute('items/[id]/route.ts', ['DELETE', 'PATCH'], 'coordinator'),
  ownerPocRoute('items/route.ts', ['POST'], 'fail_closed'),
  ownerPocRoute('journal/[id]/route.ts', ['DELETE', 'PATCH'], 'coordinator'),
  ownerPocRoute('journal/route.ts', ['POST'], 'coordinator'),
  ownerPocRoute('media/[id]/route.ts', ['DELETE', 'PATCH'], 'coordinator'),
  ownerPocRoute('media/route.ts', ['POST'], 'coordinator'),
];

void test('the complete unsafe route surface is closed over owner-cookie and explicit auth exceptions', () => {
  const actual = collectUnsafeRoutes(apiRoot);
  assert.deepEqual(
    actual.map(({ filename, methods }) => ({
      filename,
      methods: methods.map(({ method }) => method),
    })),
    closedRouteSurface.map(({ filename, methods }) => ({ filename, methods })),
    'Adding or removing an unsafe API route requires an explicit auth-policy decision in the closed route manifest.',
  );

  for (const expected of closedRouteSurface) {
    const candidate = actual.find(
      ({ filename }) => filename === expected.filename,
    );
    assert.ok(candidate, expected.filename);
    if (expected.policy === 'owner_cookie') {
      assert.ok(
        candidate.methods.every(({ protectedByOwnerCookie }) =>
          Boolean(protectedByOwnerCookie),
        ),
        `${expected.filename} must wrap every unsafe export in withOwnerWriteAuth().`,
      );
      continue;
    }

    assert.ok(
      candidate.methods.every(
        ({ protectedByOwnerCookie }) => !protectedByOwnerCookie,
      ),
      `${expected.filename} is an explicit non-cookie exception.`,
    );
    if (expected.policy === 'add_agent_token') {
      assert.match(candidate.source, /addAgentIntakeResponse/u);
      assert.match(
        candidate.source,
        /getApplication: getServerAtlasApplication/u,
      );
      continue;
    }
    assert.match(candidate.source, /ownerLoginResponse/u);
    assert.match(candidate.source, /ownerLogoutResponse/u);
  }
});

void test('every owner business write is coordinated or fails closed before legacy write work', () => {
  const actual = collectUnsafeRoutes(apiRoot);
  const actualBusinessSurface = actual
    .filter(({ filename }) =>
      ownerPocBusinessWriteSurface.some(
        (expected) => expected.filename === filename,
      ),
    )
    .flatMap(({ filename, methods }) =>
      methods.map(({ method }) => ({ filename, method })),
    );
  const expectedBusinessSurface = ownerPocBusinessWriteSurface.flatMap(
    ({ filename, methods }) => methods.map((method) => ({ filename, method })),
  );
  assert.deepEqual(actualBusinessSurface, expectedBusinessSurface);

  for (const expected of ownerPocBusinessWriteSurface) {
    const candidate = actual.find(
      ({ filename }) => filename === expected.filename,
    );
    assert.ok(candidate, expected.filename);
    for (const methodName of expected.methods) {
      const method = candidate.methods.find(
        ({ method }) => method === methodName,
      );
      assert.ok(method, `${expected.filename} ${methodName}`);
      if (expected.ownerPocPolicy === 'add_agent_operation') {
        assert.match(candidate.source, /addAgentIntakeResponse/u);
        assert.match(
          candidate.source,
          /getApplication: getServerAtlasApplication/u,
        );
        continue;
      }
      const handler = method.handlerStatements.join('\n');
      if (expected.ownerPocPolicy === 'coordinator') {
        assert.match(
          handler,
          /getServerInvocationCoordinator\(\)/u,
          `${expected.filename} ${methodName} must use the mutation coordinator`,
        );
        continue;
      }
      if (expected.ownerPocPolicy === 'application_operation') {
        assert.match(handler, /getApplication: getServerAtlasApplication/u);
        assert.match(handler, /catalogIntakeResponse/u);
        continue;
      }

      assert.match(
        method.handlerStatements[0] ?? '',
        /rejectUncoordinatedOwnerPocWrite\(\)/u,
        `${expected.filename} ${methodName} must check owner-poc policy first`,
      );
      assert.match(
        method.handlerStatements[1] ?? '',
        /if \(unavailable\) return unavailable/u,
        `${expected.filename} ${methodName} must return before legacy work`,
      );
      const policyOffset = handler.indexOf(
        'rejectUncoordinatedOwnerPocWrite()',
      );
      for (const legacyWork of [
        'request.json()',
        'request.formData()',
        'getServerAtlasApplication()',
      ]) {
        const legacyOffset = handler.indexOf(legacyWork);
        assert.ok(
          legacyOffset < 0 || policyOffset < legacyOffset,
          `${expected.filename} ${methodName} must reject before ${legacyWork}`,
        );
      }
    }
  }
});

void test('legacy POST /api/items remains an authenticated 503 in owner-poc', () => {
  const routeSource = readFileSync(
    path.join(apiRoot, 'items/route.ts'),
    'utf8',
  );
  const responseSource = readFileSync(
    fileURLToPath(
      new URL('../../../app/api/owner-mutation-response.ts', import.meta.url),
    ),
    'utf8',
  );

  assert.match(routeSource, /export const POST = withOwnerWriteAuth/u);
  assert.match(
    routeSource,
    /const unavailable = rejectUncoordinatedOwnerPocWrite\(\);\s*if \(unavailable\) return unavailable;/u,
  );
  assert.match(
    responseSource,
    /ownerPocWriteUnavailableResponse\(\): Response \{[\s\S]*?status: 503/u,
  );
});

function route(filename, methods, policy) {
  return {
    filename,
    methods: [...methods].sort((left, right) => left.localeCompare(right)),
    policy,
  };
}

function ownerPocRoute(filename, methods, ownerPocPolicy) {
  return {
    filename,
    methods: [...methods].sort((left, right) => left.localeCompare(right)),
    ownerPocPolicy,
  };
}

function collectUnsafeRoutes(root) {
  return listRouteFiles(root)
    .map((filename) => {
      const source = readFileSync(path.join(root, filename), 'utf8');
      return {
        filename,
        source,
        methods: inspectUnsafeExports(source, filename),
      };
    })
    .filter(({ methods }) => methods.length > 0)
    .sort((left, right) => left.filename.localeCompare(right.filename));
}

function listRouteFiles(root, relative = '') {
  return readdirSync(path.join(root, relative), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) return listRouteFiles(root, child);
    return entry.isFile() && entry.name === 'route.ts'
      ? [child.split(path.sep).join('/')]
      : [];
  });
}

function inspectUnsafeExports(source, filename) {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assert.equal(
    sourceFile.parseDiagnostics.length,
    0,
    `Unable to parse ${filename}.`,
  );

  const exports = [];
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      isExported(statement) &&
      statement.name &&
      unsafeMethods.has(statement.name.text)
    ) {
      exports.push({
        method: statement.name.text,
        protectedByOwnerCookie: false,
      });
      continue;
    }
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          unsafeMethods.has(declaration.name.text)
        ) {
          exports.push({
            method: declaration.name.text,
            protectedByOwnerCookie: isOwnerGuardCall(declaration.initializer),
            handlerStatements: ownerGuardHandlerStatements(
              declaration.initializer,
              sourceFile,
            ),
          });
        }
      }
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (unsafeMethods.has(element.name.text)) {
          exports.push({
            method: element.name.text,
            protectedByOwnerCookie: false,
          });
        }
      }
    }
  }
  return exports.sort((left, right) => left.method.localeCompare(right.method));
}

function isExported(node) {
  return node.modifiers?.some(
    ({ kind }) => kind === ts.SyntaxKind.ExportKeyword,
  );
}

function isOwnerGuardCall(initializer) {
  return (
    initializer &&
    ts.isCallExpression(initializer) &&
    ts.isIdentifier(initializer.expression) &&
    initializer.expression.text === 'withOwnerWriteAuth'
  );
}

function ownerGuardHandlerStatements(initializer, sourceFile) {
  if (!isOwnerGuardCall(initializer)) return [];
  const handler = initializer.arguments[0];
  if (
    !handler ||
    (!ts.isFunctionExpression(handler) && !ts.isArrowFunction(handler)) ||
    !ts.isBlock(handler.body)
  ) {
    return [];
  }
  return handler.body.statements.map((statement) =>
    statement.getText(sourceFile),
  );
}
