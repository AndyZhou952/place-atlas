import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export interface ArchitectureFitnessManifest {
  readonly webRoot: string;
  readonly productionRoots: readonly string[];
  readonly productRoot: string;
  readonly apiRoot: string;
  readonly compositionRoot: string;
  readonly applicationFactoryFile: string;
  readonly browserMappingFile: string;
  readonly browserClientFile: string;
  readonly webMcpFile: string;
  readonly capabilitiesFile: string;
  readonly uiCompatibilityModelFile: string;
  readonly expectedCoreModelAliases: readonly string[];
  readonly coreModelOwners: Readonly<Record<string, string>>;
  readonly compatibilityAdapters: {
    readonly search: string;
    readonly rating: string;
    readonly model: string;
  };
  readonly retiredFiles: readonly string[];
  readonly expectedOperationKeys: readonly string[];
  readonly expectedMediaOperationKeys: readonly string[];
  readonly expectedOperationGroupCreators: readonly string[];
  readonly businessPolicyOwners: {
    readonly search: string;
    readonly rating: string;
    readonly effectiveVisited: string;
  };
}

export interface ArchitectureViolation {
  readonly rule: ArchitectureViolationRule;
  readonly file?: string;
  readonly detail: string;
}

export type ArchitectureViolationRule =
  | 'browser_mapping_consumer'
  | 'browser_mapping_definition_count'
  | 'browser_mapping_nonliteral'
  | 'compatibility_adapter_dependency_effect'
  | 'compatibility_adapter_shape'
  | 'consumer_http_mapping'
  | 'decoy_application_factory'
  | 'dependency_cycle'
  | 'duplicate_business_policy'
  | 'duplicate_core_model'
  | 'duplicate_operation_group'
  | 'duplicate_operation_key'
  | 'dynamic_catalog_composition'
  | 'dynamic_catalog_spread'
  | 'dynamic_operation_group'
  | 'floating_operation_group'
  | 'forbidden_product_import'
  | 'invalid_operation_result_kind'
  | 'mapping_declaration_outside_owner'
  | 'missing_composed_operation'
  | 'missing_composition_root'
  | 'missing_operation_key'
  | 'missing_ui_compatibility_model'
  | 'nonliteral_module_import'
  | 'nonstatic_server_factory_return'
  | 'operation_descriptor_nonliteral'
  | 'operation_descriptor_type_mismatch'
  | 'operation_group_count'
  | 'operation_group_cycle'
  | 'operation_group_map_mismatch'
  | 'operation_result_kind_mismatch'
  | 'parse_error'
  | 'retired_file'
  | 'route_storage_bypass'
  | 'second_browser_mapping'
  | 'second_mapping_consumer'
  | 'sibling_operation_import'
  | 'unexpected_operation_key'
  | 'unowned_catalog_entry'
  | 'unowned_group_entry'
  | 'unowned_operation_definition'
  | 'unowned_operation_group'
  | 'unsupported_application_factory_binding';

interface ParsedFile {
  readonly filename: string;
  readonly source: ts.SourceFile;
  readonly diagnostics: readonly ts.Diagnostic[];
}

interface ModuleReference {
  readonly specifier?: string;
  readonly text: string;
}

interface RuntimeDependencyIssue {
  readonly filenames: readonly string[];
  readonly reason: 'cycle' | 'nonlocal' | 'top-level-effect' | 'unresolved';
}

interface OperationDescriptor {
  readonly key?: string;
  readonly resultKind?: string;
  readonly typeKey?: string;
  readonly typeKind?: string;
  readonly variableName: string;
  readonly filename: string;
  readonly declarationStart: number;
  readonly valid: boolean;
}

interface OperationGroupDefinition {
  readonly name: string;
  readonly file: ParsedFile;
  readonly checker: ts.TypeChecker;
  readonly declarationStart: number;
  readonly expression: ts.Expression;
}

interface CatalogEntry {
  readonly key: string;
  readonly resultKind: string;
  readonly definitionId: string;
  readonly groupName: string;
}

interface SemanticSource {
  readonly source: ts.SourceFile;
  readonly checker: ts.TypeChecker;
}

export function auditArchitecture(
  manifest: ArchitectureFitnessManifest,
): readonly ArchitectureViolation[] {
  try {
    return auditArchitectureUnsafe(manifest);
  } catch {
    throw new Error('Architecture fitness failed: internal-error');
  }
}

function auditArchitectureUnsafe(
  manifest: ArchitectureFitnessManifest,
): readonly ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const productionFiles = unique(
    manifest.productionRoots.flatMap(productionFilesIn),
  );
  const parsedFiles = productionFiles.map(parseFile);
  const parsedByFilename = new Map(
    parsedFiles.map((file) => [path.normalize(file.filename), file]),
  );
  const productFiles = parsedFiles.filter((file) =>
    isWithin(file.filename, manifest.productRoot),
  );

  for (const retired of manifest.retiredFiles) {
    if (existsSync(path.join(manifest.webRoot, retired))) {
      addViolation(violations, {
        rule: 'retired_file',
        file: retired,
        detail: 'retired-file-present',
      });
    }
  }
  for (const file of parsedFiles) {
    if (file.diagnostics.length > 0) {
      addViolation(violations, {
        rule: 'parse_error',
        file: relative(manifest, file.filename),
        detail: 'syntax-error',
      });
    }
  }

  auditApiStorage(manifest, parsedFiles, violations);
  auditProductImports(manifest, productFiles, violations);
  auditDependencyGraph(manifest, parsedFiles, parsedByFilename, violations);
  auditOperationCatalog(manifest, productFiles, parsedByFilename, violations);
  auditBrowserMapping(manifest, parsedFiles, parsedByFilename, violations);
  auditBusinessPolicies(manifest, parsedFiles, violations);
  auditUiModelAliases(manifest, parsedFiles, violations);
  auditCompatibilityAdapters(manifest, parsedByFilename, violations);
  auditBusinessPolicyDependencyEffects(manifest, parsedByFilename, violations);
  return sanitizeArchitectureViolations(manifest, violations);
}

function auditApiStorage(
  manifest: ArchitectureFitnessManifest,
  files: readonly ParsedFile[],
  violations: ArchitectureViolation[],
): void {
  for (const file of files.filter((candidate) =>
    isWithin(candidate.filename, manifest.apiRoot),
  )) {
    for (const reference of collectModuleReferences(file.source)) {
      if (
        reference.specifier &&
        /(?:atlas-store|media-store|(?:^|\/)db(?:\/|$))/u.test(
          reference.specifier,
        )
      ) {
        addViolation(violations, {
          rule: 'route_storage_bypass',
          file: relative(manifest, file.filename),
          detail: 'legacy-storage-import',
        });
      }
    }
    walk(file.source, (node) => {
      if (
        ts.isIdentifier(node) &&
        (node.text === 'getD1' || node.text === 'getMediaBucket')
      ) {
        addViolation(violations, {
          rule: 'route_storage_bypass',
          file: relative(manifest, file.filename),
          detail: 'server-storage-access',
        });
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === 'prepare' ||
          node.expression.name.text === 'batch')
      ) {
        addViolation(violations, {
          rule: 'route_storage_bypass',
          file: relative(manifest, file.filename),
          detail: 'database-call',
        });
      }
      if (
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node)) &&
        /(?:\bSELECT\b[\s\S]*\bFROM\b|\bINSERT\s+INTO\b|\bUPDATE\b[\s\S]*\bSET\b|\bDELETE\s+FROM\b|\b(?:CREATE|ALTER|DROP)\s+TABLE\b)/iu.test(
          node.text,
        )
      ) {
        addViolation(violations, {
          rule: 'route_storage_bypass',
          file: relative(manifest, file.filename),
          detail: 'raw-sql',
        });
      }
      if (
        ts.isTaggedTemplateExpression(node) &&
        ts.isIdentifier(node.tag) &&
        node.tag.text === 'sql'
      ) {
        addViolation(violations, {
          rule: 'route_storage_bypass',
          file: relative(manifest, file.filename),
          detail: 'sql-tag',
        });
      }
    });
  }
}

function auditProductImports(
  manifest: ArchitectureFitnessManifest,
  files: readonly ParsedFile[],
  violations: ArchitectureViolation[],
): void {
  for (const file of files) {
    for (const reference of collectModuleReferences(file.source)) {
      if (!reference.specifier) {
        addViolation(violations, {
          rule: 'nonliteral_module_import',
          file: relative(manifest, file.filename),
          detail: 'dynamic-module-reference',
        });
        continue;
      }
      const specifier = reference.specifier;
      if (
        !specifier.startsWith('.') ||
        /(?:react|next|webmcp|d1|r2|vendor|features|cloudflare|drizzle)/iu.test(
          specifier,
        )
      ) {
        addViolation(violations, {
          rule: 'forbidden_product_import',
          file: relative(manifest, file.filename),
          detail: safeModuleSpecifierDetail(manifest, file.filename, specifier),
        });
      }
      if (
        isOperationModule(file.filename) &&
        isOperationModule(stripKnownExtension(specifier))
      ) {
        addViolation(violations, {
          rule: 'sibling_operation_import',
          file: relative(manifest, file.filename),
          detail: 'sibling-operation-module',
        });
      }
    }
  }
}

function auditDependencyGraph(
  manifest: ArchitectureFitnessManifest,
  files: readonly ParsedFile[],
  parsedByFilename: ReadonlyMap<string, ParsedFile>,
  violations: ArchitectureViolation[],
): void {
  const graph = new Map(
    files.map((file) => [
      path.normalize(file.filename),
      collectModuleReferences(file.source).flatMap((reference) => {
        if (!reference.specifier) return [];
        const resolved = resolveImport(
          manifest.webRoot,
          file.filename,
          reference.specifier,
        );
        return resolved && parsedByFilename.has(resolved) ? [resolved] : [];
      }),
    ]),
  );
  const cycle = findCycle(graph);
  if (cycle.length) {
    addViolation(violations, {
      rule: 'dependency_cycle',
      file: relative(manifest, cycle[0]),
      detail: 'cycle-detected',
    });
  }
}

function auditOperationCatalog(
  manifest: ArchitectureFitnessManifest,
  productFiles: readonly ParsedFile[],
  parsedByFilename: ReadonlyMap<string, ParsedFile>,
  violations: ArchitectureViolation[],
): void {
  const definitions = productFiles.flatMap((file) =>
    collectOperationDescriptors(file, manifest, violations),
  );
  const definitionsById = new Map(
    definitions.map((definition) => [
      operationDefinitionId(definition),
      definition,
    ]),
  );
  const groups = collectOperationGroups(productFiles, manifest, violations);
  const groupsByName = new Map(groups.map((group) => [group.name, group]));
  const parsedComposition = parsedByFilename.get(
    path.normalize(manifest.compositionRoot),
  );
  if (!parsedComposition) {
    addViolation(violations, {
      rule: 'missing_composition_root',
      file: relative(manifest, manifest.compositionRoot),
      detail: 'missing',
    });
    return;
  }
  const semanticComposition = createSemanticSource(parsedComposition.filename);
  const composition: ParsedFile = {
    ...parsedComposition,
    source: semanticComposition.source,
  };

  const applicationCall = resolveServerApplicationFactoryCall(
    composition,
    semanticComposition.checker,
    manifest,
    violations,
  );

  const consumedCompositionCalls = new Set<ts.CallExpression>();
  const directGroupCounts = new Map<string, number>();
  const reachableGroups = new Set<string>();
  const reachableDefinitions = new Set<string>();
  const groupStack = new Set<string>();

  const evaluateGroup = (name: string): CatalogEntry[] => {
    const group = groupsByName.get(name);
    if (!group) {
      addViolation(violations, {
        rule: 'unowned_operation_group',
        file: relative(manifest, composition.filename),
        detail: safeDiagnosticIdentifier(name, 'operation-group'),
      });
      return [];
    }
    if (groupStack.has(name)) {
      addViolation(violations, {
        rule: 'operation_group_cycle',
        file: relative(manifest, group.file.filename),
        detail: 'operation-group-cycle',
      });
      return [];
    }
    groupStack.add(name);
    reachableGroups.add(name);
    const entries = evaluateGroupExpression(
      group.expression,
      group,
      definitionsById,
      groupsByName,
      evaluateGroup,
      reachableDefinitions,
      manifest,
      violations,
    );
    groupStack.delete(name);
    return entries;
  };

  const applicationArgument = unwrapExpression(applicationCall?.arguments[0]);
  const entries = applicationArgument
    ? evaluateCompositionExpression(
        applicationArgument,
        composition,
        semanticComposition.checker,
        groupsByName,
        evaluateGroup,
        consumedCompositionCalls,
        directGroupCounts,
        manifest,
        violations,
      )
    : [];
  if (!applicationArgument) {
    addViolation(violations, {
      rule: 'dynamic_catalog_composition',
      file: relative(manifest, composition.filename),
      detail: 'missing-static-catalog',
    });
  }

  for (const creator of manifest.expectedOperationGroupCreators) {
    const count = directGroupCounts.get(creator) ?? 0;
    if (count !== 1) {
      addViolation(violations, {
        rule: 'operation_group_count',
        file: relative(manifest, composition.filename),
        detail: `${safeDiagnosticIdentifier(creator, 'operation-group')}:${count}`,
      });
    }
  }
  walk(composition.source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
    const group = findBoundOperationGroup(
      node.expression,
      composition,
      semanticComposition.checker,
      groupsByName,
      manifest,
    );
    if (group && !consumedCompositionCalls.has(node)) {
      addViolation(violations, {
        rule: 'floating_operation_group',
        file: relative(manifest, composition.filename),
        detail: safeDiagnosticIdentifier(group.name, 'operation-group'),
      });
    }
  });

  for (const group of groups) {
    if (!reachableGroups.has(group.name)) {
      addViolation(violations, {
        rule: 'unowned_operation_group',
        file: relative(manifest, group.file.filename),
        detail: safeDiagnosticIdentifier(group.name, 'operation-group'),
      });
    }
  }
  for (const definition of definitions) {
    if (!reachableDefinitions.has(operationDefinitionId(definition))) {
      addViolation(violations, {
        rule: 'unowned_operation_definition',
        file: relative(manifest, definition.filename),
        detail: safeDiagnosticIdentifier(
          definition.variableName,
          'operation-definition',
        ),
      });
    }
  }

  auditComposedEntries(manifest, entries, violations);
}

function resolveServerApplicationFactoryCall(
  composition: ParsedFile,
  checker: ts.TypeChecker,
  manifest: ArchitectureFitnessManifest,
  violations: ArchitectureViolation[],
): ts.CallExpression | undefined {
  const expectedFactory = path.normalize(manifest.applicationFactoryFile);
  const namedBindings = new Set<ts.Symbol>();
  let unsupportedBinding = false;

  for (const statement of composition.source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      resolveImport(
        manifest.webRoot,
        composition.filename,
        statement.moduleSpecifier.text,
      ) === expectedFactory
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (
            (element.propertyName?.text ?? element.name.text) ===
            'createAtlasApplication'
          ) {
            const symbol = checker.getSymbolAtLocation(element.name);
            if (symbol) namedBindings.add(symbol);
          }
        }
      } else {
        unsupportedBinding = true;
      }
      if (statement.importClause?.name) unsupportedBinding = true;
      continue;
    }
    if (
      (ts.isImportEqualsDeclaration(statement) ||
        containsNode(
          statement,
          (node) =>
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) &&
                node.expression.text === 'require')),
        )) &&
      collectModuleReferences(
        ts.createSourceFile(
          composition.filename,
          statement.getText(composition.source),
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        ),
      ).some(
        (reference) =>
          reference.specifier &&
          resolveImport(
            manifest.webRoot,
            composition.filename,
            reference.specifier,
          ) === expectedFactory,
      )
    ) {
      unsupportedBinding = true;
    }
  }

  if (unsupportedBinding || namedBindings.size === 0) {
    addViolation(violations, {
      rule: 'unsupported_application_factory_binding',
      file: relative(manifest, composition.filename),
      detail: 'unsupported-factory-binding',
    });
  }

  const serverFactories = composition.source.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'createServerAtlasApplication' &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) === true,
  );
  if (serverFactories.length !== 1 || !serverFactories[0].body) {
    addViolation(violations, {
      rule: 'nonstatic_server_factory_return',
      file: relative(manifest, composition.filename),
      detail: `server-factory-count:${serverFactories.length}`,
    });
    return undefined;
  }
  const returns = serverFactories[0].body.statements.filter(
    ts.isReturnStatement,
  );
  const returned =
    returns.length === 1 ? unwrapExpression(returns[0].expression) : undefined;
  const actualCall =
    returned &&
    ts.isCallExpression(returned) &&
    ts.isIdentifier(returned.expression) &&
    resolvesToAnySymbol(
      returned.expression,
      namedBindings,
      composition.source,
      checker,
    )
      ? returned
      : undefined;
  if (!actualCall) {
    addViolation(violations, {
      rule: 'nonstatic_server_factory_return',
      file: relative(manifest, composition.filename),
      detail:
        returns.length === 1
          ? 'server-factory-return-not-static'
          : `server-factory-return-count:${returns.length}`,
    });
  }

  const boundCalls: ts.CallExpression[] = [];
  walk(composition.source, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      resolvesToAnySymbol(
        node.expression,
        namedBindings,
        composition.source,
        checker,
      )
    ) {
      boundCalls.push(node);
    }
  });
  for (const call of boundCalls) {
    if (call !== actualCall) {
      addViolation(violations, {
        rule: 'decoy_application_factory',
        file: relative(manifest, composition.filename),
        detail: 'decoy-factory-call',
      });
    }
  }
  return actualCall;
}

function collectOperationDescriptors(
  file: ParsedFile,
  manifest: ArchitectureFitnessManifest,
  violations: ArchitectureViolation[],
): OperationDescriptor[] {
  const descriptors: OperationDescriptor[] = [];
  walk(file.source, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isIdentifier(node.name) ||
      !isOperationDefinitionType(node.type)
    ) {
      return;
    }
    const typeKey = literalTypeArgument(node.type, 0);
    const typeKind = literalTypeArgument(node.type, 3);
    const initializer = unwrapExpression(node.initializer);
    const descriptor =
      initializer && ts.isObjectLiteralExpression(initializer)
        ? staticProperty(initializer, 'descriptor')
        : undefined;
    const descriptorObject = descriptor
      ? unwrapExpression(descriptor.initializer)
      : undefined;
    const key =
      descriptorObject && ts.isObjectLiteralExpression(descriptorObject)
        ? stringProperty(descriptorObject, 'key')
        : undefined;
    const resultKind =
      descriptorObject && ts.isObjectLiteralExpression(descriptorObject)
        ? stringProperty(descriptorObject, 'resultKind')
        : undefined;
    const valid = Boolean(typeKey && typeKind && key && resultKind);
    if (!valid) {
      addViolation(violations, {
        rule: 'operation_descriptor_nonliteral',
        file: relative(manifest, file.filename),
        detail: safeDiagnosticIdentifier(
          node.name.text,
          'operation-definition',
        ),
      });
    } else if (typeKey !== key || typeKind !== resultKind) {
      addViolation(violations, {
        rule: 'operation_descriptor_type_mismatch',
        file: relative(manifest, file.filename),
        detail: 'descriptor-type-mismatch',
      });
    }
    descriptors.push({
      ...(key ? { key } : {}),
      ...(resultKind ? { resultKind } : {}),
      ...(typeKey ? { typeKey } : {}),
      ...(typeKind ? { typeKind } : {}),
      variableName: node.name.text,
      filename: file.filename,
      declarationStart: node.getStart(file.source),
      valid,
    });
  });
  return descriptors;
}

function collectOperationGroups(
  files: readonly ParsedFile[],
  manifest: ArchitectureFitnessManifest,
  violations: ArchitectureViolation[],
): OperationGroupDefinition[] {
  const groups: OperationGroupDefinition[] = [];
  const semanticFiles = new Map<string, SemanticSource>();
  for (const file of files) {
    for (const statement of file.source.statements) {
      if (
        !ts.isFunctionDeclaration(statement) ||
        !statement.name ||
        !statement.name.text.startsWith('create') ||
        !statement.name.text.endsWith('OperationGroup') ||
        !statement.body
      ) {
        continue;
      }
      const semantic =
        semanticFiles.get(file.filename) ?? createSemanticSource(file.filename);
      semanticFiles.set(file.filename, semantic);
      const semanticStatement = semantic.source.statements.find(
        (candidate): candidate is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(candidate) &&
          candidate.name?.text === statement.name?.text,
      );
      const returns = semanticStatement?.body?.statements.filter(
        ts.isReturnStatement,
      );
      const expression =
        returns?.length === 1
          ? unwrapExpression(returns[0].expression)
          : undefined;
      if (
        !semanticStatement ||
        !expression ||
        !ts.isCallExpression(expression) ||
        !ts.isIdentifier(expression.expression) ||
        !isImportedBindingFrom(
          expression.expression,
          'defineOperationGroup',
          manifest.applicationFactoryFile,
          { ...file, source: semantic.source },
          semantic.checker,
          manifest,
        ) ||
        expression.arguments.length !== 1
      ) {
        addViolation(violations, {
          rule: 'dynamic_operation_group',
          file: relative(manifest, file.filename),
          detail: safeDiagnosticIdentifier(
            statement.name.text,
            'operation-group',
          ),
        });
        continue;
      }
      groups.push({
        name: statement.name.text,
        file: { ...file, source: semantic.source },
        checker: semantic.checker,
        declarationStart: semanticStatement.getStart(semantic.source),
        expression: expression.arguments[0],
      });
    }
  }
  for (const name of duplicateValues(groups.map((group) => group.name))) {
    addViolation(violations, {
      rule: 'duplicate_operation_group',
      detail: safeDiagnosticIdentifier(name, 'operation-group'),
    });
  }
  return groups;
}

function evaluateGroupExpression(
  expression: ts.Expression,
  group: OperationGroupDefinition,
  definitions: ReadonlyMap<string, OperationDescriptor>,
  groups: ReadonlyMap<string, OperationGroupDefinition>,
  evaluateGroup: (name: string) => CatalogEntry[],
  reachableDefinitions: Set<string>,
  manifest: ArchitectureFitnessManifest,
  violations: ArchitectureViolation[],
): CatalogEntry[] {
  const resolved = resolveLocalExpression(
    expression,
    group.file.source,
    group.checker,
  );
  if (!resolved || !ts.isObjectLiteralExpression(resolved)) {
    addViolation(violations, {
      rule: 'dynamic_operation_group',
      file: relative(manifest, group.file.filename),
      detail: safeDiagnosticIdentifier(group.name, 'operation-group'),
    });
    return [];
  }
  const entries: CatalogEntry[] = [];
  for (const property of resolved.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = unwrapExpression(property.expression);
      const call = resolveLocalGroupCall(
        spread,
        group.file.source,
        group.checker,
      );
      const nestedGroup =
        call && ts.isIdentifier(call.expression)
          ? findBoundOperationGroup(
              call.expression,
              group.file,
              group.checker,
              groups,
              manifest,
            )
          : undefined;
      if (nestedGroup) {
        entries.push(...evaluateGroup(nestedGroup.name));
      } else {
        addViolation(violations, {
          rule: 'dynamic_operation_group',
          file: relative(manifest, group.file.filename),
          detail: 'dynamic-group-spread',
        });
      }
      continue;
    }
    if (!ts.isPropertyAssignment(property)) {
      addViolation(violations, {
        rule: 'unowned_group_entry',
        file: relative(manifest, group.file.filename),
        detail: 'non-property-group-entry',
      });
      continue;
    }
    const key = propertyName(property.name);
    const initializer = unwrapExpression(property.initializer);
    if (!key || !initializer || !ts.isIdentifier(initializer)) {
      addViolation(violations, {
        rule: 'unowned_group_entry',
        file: relative(manifest, group.file.filename),
        detail: 'unresolved-group-entry',
      });
      continue;
    }
    const definition = findBoundOperationDefinition(
      initializer,
      definitions,
      group.file.source,
      group.checker,
    );
    const id = definition ? operationDefinitionId(definition) : undefined;
    if (
      !definition ||
      !id ||
      !definition.valid ||
      definition.key !== key ||
      definition.typeKey !== key ||
      !definition.resultKind ||
      definition.typeKind !== definition.resultKind
    ) {
      addViolation(violations, {
        rule: 'operation_group_map_mismatch',
        file: relative(manifest, group.file.filename),
        detail: 'group-map-key-mismatch',
      });
      continue;
    }
    reachableDefinitions.add(id);
    entries.push({
      key,
      resultKind: definition.resultKind,
      definitionId: id,
      groupName: group.name,
    });
  }
  return entries;
}

function evaluateCompositionExpression(
  expression: ts.Expression,
  composition: ParsedFile,
  checker: ts.TypeChecker,
  groups: ReadonlyMap<string, OperationGroupDefinition>,
  evaluateGroup: (name: string) => CatalogEntry[],
  consumedCalls: Set<ts.CallExpression>,
  directGroupCounts: Map<string, number>,
  manifest: ArchitectureFitnessManifest,
  violations: ArchitectureViolation[],
): CatalogEntry[] {
  const resolved = resolveLocalExpression(
    expression,
    composition.source,
    checker,
  );
  if (!resolved || !ts.isObjectLiteralExpression(resolved)) {
    addViolation(violations, {
      rule: 'dynamic_catalog_composition',
      file: relative(manifest, composition.filename),
      detail: 'catalog-expression-not-static',
    });
    return [];
  }
  const entries: CatalogEntry[] = [];
  for (const property of resolved.properties) {
    if (!ts.isSpreadAssignment(property)) {
      addViolation(violations, {
        rule: 'unowned_catalog_entry',
        file: relative(manifest, composition.filename),
        detail: 'non-spread-catalog-entry',
      });
      continue;
    }
    const spread = unwrapExpression(property.expression);
    const call = resolveLocalGroupCall(spread, composition.source, checker);
    const group =
      call && ts.isIdentifier(call.expression)
        ? findBoundOperationGroup(
            call.expression,
            composition,
            checker,
            groups,
            manifest,
          )
        : undefined;
    if (!call || !group) {
      addViolation(violations, {
        rule: 'dynamic_catalog_spread',
        file: relative(manifest, composition.filename),
        detail: 'unresolved-catalog-spread',
      });
      continue;
    }
    consumedCalls.add(call);
    directGroupCounts.set(
      group.name,
      (directGroupCounts.get(group.name) ?? 0) + 1,
    );
    entries.push(...evaluateGroup(group.name));
  }
  return entries;
}

function auditComposedEntries(
  manifest: ArchitectureFitnessManifest,
  entries: readonly CatalogEntry[],
  violations: ArchitectureViolation[],
): void {
  const keys = entries.map((entry) => entry.key);
  for (const key of duplicateValues(keys)) {
    addViolation(violations, {
      rule: 'duplicate_operation_key',
      detail: safeDiagnosticIdentifier(key, 'operation-key'),
    });
  }
  for (const key of manifest.expectedOperationKeys) {
    if (!keys.includes(key)) {
      addViolation(violations, {
        rule: 'missing_composed_operation',
        detail: safeDiagnosticIdentifier(key, 'operation-key'),
      });
      addViolation(violations, {
        rule: 'missing_operation_key',
        detail: safeDiagnosticIdentifier(key, 'operation-key'),
      });
    }
  }
  for (const entry of entries) {
    if (!manifest.expectedOperationKeys.includes(entry.key)) {
      addViolation(violations, {
        rule: 'unexpected_operation_key',
        detail: safeDiagnosticIdentifier(entry.key, 'operation-key'),
      });
    }
    if (entry.resultKind !== 'json' && entry.resultKind !== 'media_stream') {
      addViolation(violations, {
        rule: 'invalid_operation_result_kind',
        detail: `${safeDiagnosticIdentifier(entry.key, 'operation-key')}:${safeDiagnosticIdentifier(entry.resultKind, 'result-kind')}`,
      });
    }
    const expectedMedia = manifest.expectedMediaOperationKeys.includes(
      entry.key,
    );
    if ((entry.resultKind === 'media_stream') !== expectedMedia) {
      addViolation(violations, {
        rule: 'operation_result_kind_mismatch',
        detail: `${safeDiagnosticIdentifier(entry.key, 'operation-key')}:${safeDiagnosticIdentifier(entry.resultKind, 'result-kind')}`,
      });
    }
  }
}

function auditBrowserMapping(
  manifest: ArchitectureFitnessManifest,
  files: readonly ParsedFile[],
  parsedByFilename: ReadonlyMap<string, ParsedFile>,
  violations: ArchitectureViolation[],
): void {
  const mappingFiles: string[] = [];
  const definingFiles: string[] = [];
  for (const file of files) {
    let hasMapping = false;
    if (
      path.normalize(file.filename) !==
        path.normalize(manifest.browserMappingFile) &&
      hasHttpMappingShape(file.source)
    ) {
      addViolation(violations, {
        rule: 'mapping_declaration_outside_owner',
        file: relative(manifest, file.filename),
        detail: 'mapping-outside-owner',
      });
    }
    walk(file.source, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'defineBrowserOperationHttpCatalog'
      ) {
        definingFiles.push(file.filename);
      }
      if (!ts.isObjectLiteralExpression(node)) return;
      const method = stringProperty(node, 'method');
      const pathValue = stringProperty(node, 'path');
      const bodyKind = stringProperty(node, 'bodyKind');
      const key = stringProperty(node, 'key');
      const looksLikeMapping = Boolean(
        pathValue || bodyKind || (key && method),
      );
      if (!looksLikeMapping) return;
      if (!method || !pathValue || !bodyKind || !key) {
        addViolation(violations, {
          rule: 'browser_mapping_nonliteral',
          file: relative(manifest, file.filename),
          detail: 'mapping-not-static',
        });
        return;
      }
      if (pathValue.startsWith('/api/')) hasMapping = true;
    });
    if (hasMapping) mappingFiles.push(file.filename);
  }
  if (
    mappingFiles.length !== 1 ||
    path.normalize(mappingFiles[0] ?? '') !==
      path.normalize(manifest.browserMappingFile)
  ) {
    addViolation(violations, {
      rule: 'second_browser_mapping',
      detail: `mapping-file-count:${mappingFiles.length}`,
    });
  }
  if (
    definingFiles.length !== 1 ||
    path.normalize(definingFiles[0] ?? '') !==
      path.normalize(manifest.browserMappingFile)
  ) {
    addViolation(violations, {
      rule: 'browser_mapping_definition_count',
      detail: `mapping-definition-count:${definingFiles.length}`,
    });
  }

  auditMappingConsumer(
    manifest,
    parsedByFilename,
    manifest.browserClientFile,
    'browserOperationHttpCatalog',
    violations,
  );

  const allowedConsumerSymbols = new Map<string, ReadonlySet<string>>([
    [
      path.normalize(manifest.browserClientFile),
      new Set([
        'browserOperationHttpCatalog',
        'browserOperationPath',
        'BrowserOperationKey',
      ]),
    ],
    [
      path.normalize(manifest.webMcpFile),
      new Set(['browserOperationHttpCatalog']),
    ],
    [
      path.normalize(manifest.capabilitiesFile),
      new Set(['createAgentCapabilitiesDocument']),
    ],
  ]);
  for (const file of files) {
    if (
      path.normalize(file.filename) !==
        path.normalize(manifest.browserMappingFile) &&
      declaresMappingSymbol(file.source)
    ) {
      addViolation(violations, {
        rule: 'mapping_declaration_outside_owner',
        file: relative(manifest, file.filename),
        detail: 'mapping-symbol-outside-owner',
      });
    }
    if (
      path.normalize(file.filename) !==
      path.normalize(manifest.browserMappingFile)
    ) {
      auditCanonicalMappingImports(
        manifest,
        file,
        allowedConsumerSymbols,
        violations,
      );
    }
  }
  auditMappingConsumer(
    manifest,
    parsedByFilename,
    manifest.webMcpFile,
    'browserOperationHttpCatalog',
    violations,
  );
  auditMappingConsumer(
    manifest,
    parsedByFilename,
    manifest.capabilitiesFile,
    'createAgentCapabilitiesDocument',
    violations,
  );

  for (const filename of allowedConsumerSymbols.keys()) {
    const consumer = parsedByFilename.get(filename);
    if (consumer && containsConsumerHttpMapping(consumer.source)) {
      addViolation(violations, {
        rule: 'consumer_http_mapping',
        file: relative(manifest, consumer.filename),
        detail: 'consumer-http-mapping',
      });
    }
  }
  const capabilities = parsedByFilename.get(
    path.normalize(manifest.capabilitiesFile),
  );
  if (capabilities && hasDirectOperationsArray(capabilities.source)) {
    addViolation(violations, {
      rule: 'second_browser_mapping',
      file: relative(manifest, capabilities.filename),
      detail: 'capabilities-direct-catalog',
    });
  }
}

function auditCanonicalMappingImports(
  manifest: ArchitectureFitnessManifest,
  file: ParsedFile,
  allowedConsumers: ReadonlyMap<string, ReadonlySet<string>>,
  violations: ArchitectureViolation[],
): void {
  const canonicalOwner = path.normalize(manifest.browserMappingFile);
  const referencesOwner = collectModuleReferences(file.source).some(
    (reference) =>
      reference.specifier !== undefined &&
      resolveImport(manifest.webRoot, file.filename, reference.specifier) ===
        canonicalOwner,
  );
  if (!referencesOwner) return;

  const allowedSymbols = allowedConsumers.get(path.normalize(file.filename));
  let hasOnlyAllowedNamedImports = Boolean(allowedSymbols);
  for (const statement of file.source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      resolveImport(
        manifest.webRoot,
        file.filename,
        statement.moduleSpecifier.text,
      ) !== canonicalOwner
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || !allowedSymbols) {
      hasOnlyAllowedNamedImports = false;
      continue;
    }
    if (
      statement.importClause?.name ||
      bindings.elements.some(
        (element) =>
          !allowedSymbols.has(element.propertyName?.text ?? element.name.text),
      )
    ) {
      hasOnlyAllowedNamedImports = false;
    }
  }
  const allOwnerReferencesAreStaticImports = collectModuleReferences(
    file.source,
  )
    .filter(
      (reference) =>
        reference.specifier !== undefined &&
        resolveImport(manifest.webRoot, file.filename, reference.specifier) ===
          canonicalOwner,
    )
    .every((reference) =>
      file.source.statements.some(
        (statement) =>
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.getText(file.source) === reference.text,
      ),
    );
  if (!hasOnlyAllowedNamedImports || !allOwnerReferencesAreStaticImports) {
    addViolation(violations, {
      rule: 'second_mapping_consumer',
      file: relative(manifest, file.filename),
      detail: 'unapproved-mapping-consumer',
    });
  }
}

function containsConsumerHttpMapping(source: ts.SourceFile): boolean {
  let found = false;
  walk(source, (node) => {
    if (found) return;
    if (
      (ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      node.text.includes('/api/')
    ) {
      found = true;
      return;
    }
    if (ts.isExpression(node)) {
      const value = evaluateStaticString(node, source);
      if (value?.includes('/api/')) {
        found = true;
        return;
      }
    }
    if (ts.isArrayLiteralExpression(node)) {
      const values = node.elements.map((element) =>
        ts.isExpression(element)
          ? evaluateStaticString(element, source)
          : undefined,
      );
      if (
        values.some((value) =>
          /^(?:GET|POST|PATCH|DELETE)$/u.test(value ?? ''),
        ) &&
        values.some((value) => value?.includes('/api/')) &&
        values.some((value) => /^(?:none|json|multipart)$/u.test(value ?? ''))
      ) {
        found = true;
      }
    }
  });
  return found;
}

function auditMappingConsumer(
  manifest: ArchitectureFitnessManifest,
  files: ReadonlyMap<string, ParsedFile>,
  filename: string,
  importedName: string,
  violations: ArchitectureViolation[],
): void {
  const file = files.get(path.normalize(filename));
  if (
    !file ||
    !importsIdentifierFrom(
      file,
      importedName,
      manifest.browserMappingFile,
      manifest,
    )
  ) {
    addViolation(violations, {
      rule: 'browser_mapping_consumer',
      file: relative(manifest, filename),
      detail: safeDiagnosticIdentifier(importedName, 'mapping-symbol'),
    });
  }
}

function hasHttpMappingShape(source: ts.SourceFile): boolean {
  let shapedDeclaration = false;
  walk(source, (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = new Set(
        node.properties.flatMap((property) => {
          if (
            ts.isPropertyAssignment(property) ||
            ts.isShorthandPropertyAssignment(property) ||
            ts.isMethodDeclaration(property)
          ) {
            const name = propertyName(property.name);
            return name ? [name] : [];
          }
          return [];
        }),
      );
      if (names.has('method') && names.has('path') && names.has('bodyKind')) {
        shapedDeclaration = true;
      }
    }
    if (ts.isTypeLiteralNode(node) || ts.isInterfaceDeclaration(node)) {
      const members = ts.isTypeLiteralNode(node) ? node.members : node.members;
      const names = new Set(
        [...members].flatMap((member) => {
          if (
            (ts.isPropertySignature(member) || ts.isMethodSignature(member)) &&
            member.name
          ) {
            const name = propertyName(member.name);
            return name ? [name] : [];
          }
          return [];
        }),
      );
      if (names.has('method') && names.has('path') && names.has('bodyKind')) {
        shapedDeclaration = true;
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.type &&
      /(?:mapping|catalog|descriptor|routes|operations)/iu.test(
        node.name.text,
      ) &&
      containsNode(
        node.type,
        (candidate) =>
          ts.isTypeReferenceNode(candidate) &&
          ts.isIdentifier(candidate.typeName) &&
          candidate.typeName.text === 'Record',
      )
    ) {
      shapedDeclaration = true;
    }
  });
  if (shapedDeclaration) return true;

  const fragments = sourceStringFragments(source);
  return (
    fragments.some((value) => /^(?:GET|POST|PATCH|DELETE)$/u.test(value)) &&
    fragments.some((value) => value.includes('/api/')) &&
    fragments.some((value) => /^(?:none|json|multipart)$/u.test(value))
  );
}

function declaresMappingSymbol(source: ts.SourceFile): boolean {
  const protectedNames = new Set([
    'BrowserOperationHttpDescriptor',
    'browserOperationHttpCatalog',
    'browserOperationPath',
    'defineBrowserOperationHttpCatalog',
  ]);
  return source.statements.some((statement) => {
    if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isFunctionDeclaration(statement)) &&
      statement.name &&
      protectedNames.has(statement.name.text)
    ) {
      return true;
    }
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          protectedNames.has(declaration.name.text),
      );
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      return statement.exportClause.elements.some((element) =>
        protectedNames.has(element.propertyName?.text ?? element.name.text),
      );
    }
    return false;
  });
}

function auditBusinessPolicies(
  manifest: ArchitectureFitnessManifest,
  files: readonly ParsedFile[],
  violations: ArchitectureViolation[],
): void {
  const implementationNames: Readonly<
    Record<
      keyof ArchitectureFitnessManifest['businessPolicyOwners'],
      ReadonlySet<string>
    >
  > = {
    search: new Set([
      'matchesAtlasQuery',
      'normalizeSearchText',
      'bigrams',
      'bigramSimilarity',
    ]),
    rating: new Set(['normalizeAssessmentRating', 'normalizeRating']),
    effectiveVisited: new Set(['isEffectivelyVisited']),
  };

  for (const file of files) {
    if (
      path.normalize(file.filename) !==
        path.normalize(manifest.businessPolicyOwners.search) &&
      isSearchHeuristicScope(file.filename, manifest) &&
      hasSearchPipelineVariant(file.source)
    ) {
      addViolation(violations, {
        rule: 'duplicate_business_policy',
        file: relative(manifest, file.filename),
        detail: 'search:lowercase-match-pipeline',
      });
    }
    walk(file.source, (node) => {
      const implementationName = implementedFunctionName(node);
      if (implementationName) {
        for (const policy of Object.keys(implementationNames) as Array<
          keyof typeof implementationNames
        >) {
          if (
            implementationNames[policy].has(implementationName) &&
            path.normalize(file.filename) !==
              path.normalize(manifest.businessPolicyOwners[policy])
          ) {
            addViolation(violations, {
              rule: 'duplicate_business_policy',
              file: relative(manifest, file.filename),
              detail: `${policy}:${safeDiagnosticIdentifier(
                implementationName,
                'policy-implementation',
              )}`,
            });
          }
        }
      }

      if (
        path.normalize(file.filename) !==
          path.normalize(manifest.businessPolicyOwners.effectiveVisited) &&
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken
      ) {
        const expression = node.getText(file.source);
        if (
          /manualVisited/u.test(expression) &&
          /(?:visitCount|visits|hasVisit)/u.test(expression)
        ) {
          addViolation(violations, {
            rule: 'duplicate_business_policy',
            file: relative(manifest, file.filename),
            detail: 'effectiveVisited:manualVisited-or-visits',
          });
        }
      }
      if (
        path.normalize(file.filename) !==
          path.normalize(manifest.businessPolicyOwners.search) &&
        isSearchPrimitive(node)
      ) {
        addViolation(violations, {
          rule: 'duplicate_business_policy',
          file: relative(manifest, file.filename),
          detail: 'search:known-primitive',
        });
      }
      if (
        path.normalize(file.filename) !==
          path.normalize(manifest.businessPolicyOwners.rating) &&
        isRatingPrimitive(node)
      ) {
        addViolation(violations, {
          rule: 'duplicate_business_policy',
          file: relative(manifest, file.filename),
          detail: 'rating:round-to-tenth',
        });
      }
      if (
        path.normalize(file.filename) !==
          path.normalize(manifest.businessPolicyOwners.effectiveVisited) &&
        isEffectiveVisitedPrimitive(node)
      ) {
        addViolation(violations, {
          rule: 'duplicate_business_policy',
          file: relative(manifest, file.filename),
          detail: 'effectiveVisited:boolean-or-positive-count',
        });
      }
    });
  }
}

function auditUiModelAliases(
  manifest: ArchitectureFitnessManifest,
  files: readonly ParsedFile[],
  violations: ArchitectureViolation[],
): void {
  const file = files.find(
    (candidate) =>
      path.normalize(candidate.filename) ===
      path.normalize(manifest.uiCompatibilityModelFile),
  );
  if (!file) {
    addViolation(violations, {
      rule: 'missing_ui_compatibility_model',
      file: relative(manifest, manifest.uiCompatibilityModelFile),
      detail: 'missing',
    });
    return;
  }
  for (const candidate of files) {
    for (const statement of candidate.source.statements) {
      const isCoreInterface =
        ts.isInterfaceDeclaration(statement) &&
        manifest.expectedCoreModelAliases.includes(statement.name.text);
      const isCoreTypeLiteral =
        ts.isTypeAliasDeclaration(statement) &&
        manifest.expectedCoreModelAliases.includes(statement.name.text) &&
        containsTypeLiteral(statement.type);
      const name =
        isCoreInterface || isCoreTypeLiteral ? statement.name.text : undefined;
      const owner = name ? manifest.coreModelOwners[name] : undefined;
      const isApprovedUiAtlasItemProjection = Boolean(
        isCoreTypeLiteral &&
        name === 'AtlasItem' &&
        path.normalize(candidate.filename) ===
          path.normalize(manifest.uiCompatibilityModelFile) &&
        isAllowedUiModelDeclaration(statement),
      );

      if (
        name &&
        (!owner ||
          path.normalize(candidate.filename) !== path.normalize(owner)) &&
        !isApprovedUiAtlasItemProjection
      ) {
        addViolation(violations, {
          rule: 'duplicate_core_model',
          file: relative(manifest, candidate.filename),
          detail: safeDiagnosticIdentifier(name, 'core-model'),
        });
      }
    }
  }
}

function auditCompatibilityAdapters(
  manifest: ArchitectureFitnessManifest,
  files: ReadonlyMap<string, ParsedFile>,
  violations: ArchitectureViolation[],
): void {
  const adapters = manifest.compatibilityAdapters;
  const dependencyCache = new Map<string, RuntimeDependencyIssue | undefined>();
  for (const [kind, filename] of Object.entries(adapters) as Array<
    [keyof typeof adapters, string]
  >) {
    const file = files.get(path.normalize(filename));
    if (!file) {
      addViolation(violations, {
        rule: 'compatibility_adapter_shape',
        file: relative(manifest, filename),
        detail: `${kind}:missing`,
      });
      continue;
    }
    for (const statement of file.source.statements) {
      const allowed =
        ((ts.isImportDeclaration(statement) ||
          ts.isExportDeclaration(statement)) &&
          isAllowedAdapterModuleStatement(kind, statement, file, manifest)) ||
        (kind === 'model' && isAllowedUiModelDeclaration(statement)) ||
        (kind === 'rating' &&
          ts.isFunctionDeclaration(statement) &&
          isAllowedRatingParser(statement));
      if (!allowed) {
        addViolation(violations, {
          rule: 'compatibility_adapter_shape',
          file: relative(manifest, file.filename),
          detail: `${kind}:unsupported-statement`,
        });
      }
    }
    const references = collectModuleReferences(file.source);
    const expectedOwner =
      kind === 'search'
        ? manifest.businessPolicyOwners.search
        : kind === 'rating'
          ? manifest.businessPolicyOwners.rating
          : undefined;
    if ((kind === 'search' || kind === 'rating') && references.length === 0) {
      addViolation(violations, {
        rule: 'compatibility_adapter_shape',
        file: relative(manifest, file.filename),
        detail: `${kind}:missing-core-dependency`,
      });
    }
    for (const reference of references) {
      const resolved = reference.specifier
        ? resolveImport(manifest.webRoot, file.filename, reference.specifier)
        : undefined;
      const validSource = expectedOwner
        ? resolved === path.normalize(expectedOwner)
        : Boolean(resolved && isWithin(resolved, manifest.productRoot));
      if (!validSource) {
        addViolation(violations, {
          rule: 'compatibility_adapter_shape',
          file: relative(manifest, file.filename),
          detail: `${kind}:invalid-dependency`,
        });
      }
      if (!isRuntimeModuleReference(file.source, reference)) continue;
      const issue = inspectRuntimeDependency(
        manifest,
        files,
        resolved,
        reference,
        dependencyCache,
        [],
      );
      if (issue) {
        addViolation(violations, {
          rule: 'compatibility_adapter_dependency_effect',
          file: relative(manifest, file.filename),
          detail: formatRuntimeDependencyIssue(kind, issue),
        });
      }
    }
  }
}

function auditBusinessPolicyDependencyEffects(
  manifest: ArchitectureFitnessManifest,
  files: ReadonlyMap<string, ParsedFile>,
  violations: ArchitectureViolation[],
): void {
  const cache = new Map<string, RuntimeDependencyIssue | undefined>();
  for (const [kind, owner] of Object.entries(manifest.businessPolicyOwners)) {
    if (!files.has(path.normalize(owner))) continue;
    const issue = inspectRuntimeModule(
      manifest,
      files,
      path.normalize(owner),
      cache,
      [],
    );
    if (!issue) continue;
    addViolation(violations, {
      rule: 'compatibility_adapter_dependency_effect',
      file: relative(manifest, owner),
      detail: formatRuntimeDependencyIssue(kind, issue),
    });
  }
}

function inspectRuntimeDependency(
  manifest: ArchitectureFitnessManifest,
  files: ReadonlyMap<string, ParsedFile>,
  resolved: string | undefined,
  reference: ModuleReference,
  cache: Map<string, RuntimeDependencyIssue | undefined>,
  stack: readonly string[],
): RuntimeDependencyIssue | undefined {
  if (!reference.specifier) {
    return {
      filenames: [],
      reason: 'unresolved',
    };
  }
  if (!isLocalModuleSpecifier(reference.specifier)) {
    return {
      filenames: [],
      reason: 'nonlocal',
    };
  }
  if (!resolved) {
    return {
      filenames: [],
      reason: 'unresolved',
    };
  }
  return inspectRuntimeModule(manifest, files, resolved, cache, stack);
}

function inspectRuntimeModule(
  manifest: ArchitectureFitnessManifest,
  files: ReadonlyMap<string, ParsedFile>,
  filename: string,
  cache: Map<string, RuntimeDependencyIssue | undefined>,
  stack: readonly string[],
): RuntimeDependencyIssue | undefined {
  const normalized = path.normalize(filename);
  const cycleStart = stack.indexOf(normalized);
  if (cycleStart >= 0) {
    return {
      filenames: [...stack.slice(cycleStart), normalized],
      reason: 'cycle',
    };
  }
  if (cache.has(normalized)) return cache.get(normalized);
  const file = files.get(normalized);
  if (!file || !isWithin(normalized, manifest.webRoot)) {
    const issue: RuntimeDependencyIssue = {
      filenames: [normalized],
      reason: 'unresolved',
    };
    cache.set(normalized, issue);
    return issue;
  }
  if (hasDirectTopLevelSideEffect(file.source)) {
    const issue: RuntimeDependencyIssue = {
      filenames: [normalized],
      reason: 'top-level-effect',
    };
    cache.set(normalized, issue);
    return issue;
  }

  const nextStack = [...stack, normalized];
  for (const reference of collectRuntimeModuleReferences(file.source)) {
    const resolved = reference.specifier
      ? resolveImport(manifest.webRoot, normalized, reference.specifier)
      : undefined;
    const nested = inspectRuntimeDependency(
      manifest,
      files,
      resolved,
      reference,
      cache,
      nextStack,
    );
    if (!nested) continue;
    if (nested.reason === 'cycle') return nested;
    const issue: RuntimeDependencyIssue = {
      ...nested,
      filenames:
        nested.filenames[0] === normalized
          ? nested.filenames
          : [normalized, ...nested.filenames],
    };
    cache.set(normalized, issue);
    return issue;
  }
  cache.set(normalized, undefined);
  return undefined;
}

function formatRuntimeDependencyIssue(
  kind: string,
  issue: RuntimeDependencyIssue,
): string {
  return `${safeDiagnosticIdentifier(kind, 'policy')}:${issue.reason}`;
}

function isLocalModuleSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('@/');
}

function isRuntimeModuleReference(
  source: ts.SourceFile,
  reference: ModuleReference,
): boolean {
  return collectRuntimeModuleReferences(source).some(
    (candidate) =>
      candidate.specifier === reference.specifier &&
      candidate.text === reference.text,
  );
}

function isAllowedAdapterModuleStatement(
  kind: keyof ArchitectureFitnessManifest['compatibilityAdapters'],
  statement: ts.ImportDeclaration | ts.ExportDeclaration,
  file: ParsedFile,
  manifest: ArchitectureFitnessManifest,
): boolean {
  if (
    !statement.moduleSpecifier ||
    !ts.isStringLiteral(statement.moduleSpecifier)
  ) {
    return false;
  }
  const source = resolveImport(
    manifest.webRoot,
    file.filename,
    statement.moduleSpecifier.text,
  );
  if (!source) return false;
  if (kind === 'search') {
    return (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      source === path.normalize(manifest.businessPolicyOwners.search) &&
      hasExactNamedExports(statement, [
        { imported: 'matchesAtlasQuery', exported: 'matchesAtlasQuery' },
      ])
    );
  }
  if (kind === 'rating') {
    if (source !== path.normalize(manifest.businessPolicyOwners.rating)) {
      return false;
    }
    return ts.isImportDeclaration(statement)
      ? hasExactNamedImports(statement, [
          {
            imported: 'normalizeAssessmentRating',
            local: 'normalizeAssessmentRating',
            typeOnly: false,
          },
        ])
      : !statement.isTypeOnly &&
          hasExactNamedExports(statement, [
            {
              imported: 'normalizeAssessmentRating',
              exported: 'normalizeRating',
              typeOnly: false,
            },
          ]);
  }
  return ts.isImportDeclaration(statement)
    ? isAllowedModelImport(statement, source, manifest)
    : isAllowedModelExport(statement, source, manifest);
}

interface ExpectedImportSpecifier {
  readonly imported: string;
  readonly local: string;
  readonly typeOnly: boolean;
}

interface ExpectedExportSpecifier {
  readonly imported: string;
  readonly exported: string;
  readonly typeOnly?: boolean;
}

function hasExactNamedImports(
  statement: ts.ImportDeclaration,
  expected: readonly ExpectedImportSpecifier[],
): boolean {
  const clause = statement.importClause;
  if (
    !clause ||
    clause.name ||
    !clause.namedBindings ||
    !ts.isNamedImports(clause.namedBindings) ||
    clause.namedBindings.elements.length !== expected.length
  ) {
    return false;
  }
  return expected.every(({ imported, local, typeOnly }) =>
    clause.namedBindings && ts.isNamedImports(clause.namedBindings)
      ? clause.namedBindings.elements.some(
          (element) =>
            (element.propertyName?.text ?? element.name.text) === imported &&
            element.name.text === local &&
            (hasDirectTypeKeyword(clause) || hasDirectTypeKeyword(element)) ===
              typeOnly,
        )
      : false,
  );
}

function hasAllowedNamedImports(
  statement: ts.ImportDeclaration,
  allowed: readonly ExpectedImportSpecifier[],
): boolean {
  const clause = statement.importClause;
  if (
    !clause ||
    clause.name ||
    !clause.namedBindings ||
    !ts.isNamedImports(clause.namedBindings) ||
    clause.namedBindings.elements.length === 0
  ) {
    return false;
  }
  return clause.namedBindings.elements.every((element) =>
    allowed.some(
      ({ imported, local, typeOnly }) =>
        (element.propertyName?.text ?? element.name.text) === imported &&
        element.name.text === local &&
        (hasDirectTypeKeyword(clause) || hasDirectTypeKeyword(element)) ===
          typeOnly,
    ),
  );
}

function hasExactNamedExports(
  statement: ts.ExportDeclaration,
  expected: readonly ExpectedExportSpecifier[],
): boolean {
  if (
    !statement.exportClause ||
    !ts.isNamedExports(statement.exportClause) ||
    statement.exportClause.elements.length !== expected.length
  ) {
    return false;
  }
  return expected.every(({ imported, exported, typeOnly }) =>
    statement.exportClause && ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.some(
          (element) =>
            (element.propertyName?.text ?? element.name.text) === imported &&
            element.name.text === exported &&
            (statement.isTypeOnly || hasDirectTypeKeyword(element)) ===
              Boolean(typeOnly),
        )
      : false,
  );
}

function hasDirectTypeKeyword(node: ts.Node): boolean {
  return node
    .getChildren(node.getSourceFile())
    .some((child) => child.kind === ts.SyntaxKind.TypeKeyword);
}

function isAllowedModelImport(
  statement: ts.ImportDeclaration,
  source: string,
  manifest: ArchitectureFitnessManifest,
): boolean {
  const specs: Array<ExpectedImportSpecifier & { readonly owner: string }> = [
    ['PlaceAssessment', 'CorePlaceAssessment', 'PlaceAssessment'],
    [
      'PlaceAssessmentPatch',
      'CorePlaceAssessmentPatch',
      'PlaceAssessmentPatch',
    ],
    ['AtlasItem', 'CoreAtlasItem', 'AtlasItem'],
    ['AtlasItemEdit', 'CoreAtlasItemEdit', 'AtlasItemEdit'],
    ['AtlasItemKind', 'CoreAtlasItemKind', 'AtlasItemKind'],
    ['EventSchedule', 'CoreEventSchedule', 'EventSchedule'],
    ['PersonalState', 'CorePersonalState', 'PersonalState'],
    ['ReservationMode', 'CoreReservationMode', 'ReservationMode'],
    ['ReservationSnapshot', 'CoreReservationSnapshot', 'ReservationSnapshot'],
    ['SourceLink', 'CoreSourceLink', 'SourceLink'],
    ['TabelogSnapshot', 'CoreTabelogSnapshot', 'TabelogSnapshot'],
    ['VerificationStatus', 'CoreVerificationStatus', 'VerificationStatus'],
    ['VisitMedia', 'CoreVisitMedia', 'VisitMediaRecord'],
    ['NewVisit', 'CoreNewVisit', 'NewVisit'],
    ['Visit', 'CoreVisit', 'VisitRecord'],
    ['VisitMutationResult', 'CoreVisitMutationResult', 'VisitMutationResult'],
    ['VisitUpdate', 'CoreVisitUpdate', 'VisitUpdate'],
  ].map(([imported, local, ownerAlias]) => ({
    imported,
    local,
    typeOnly: true,
    owner: path.normalize(manifest.coreModelOwners[ownerAlias]),
  }));
  const expected = specs
    .filter((specifier) => specifier.owner === source)
    .map(({ imported, local, typeOnly }) => ({ imported, local, typeOnly }));
  return expected.length > 0 && hasAllowedNamedImports(statement, expected);
}

function isAllowedModelExport(
  _statement: ts.ExportDeclaration,
  _source: string,
  _manifest: ArchitectureFitnessManifest,
): boolean {
  return false;
}

function hasDirectTopLevelSideEffect(source: ts.SourceFile): boolean {
  return source.statements.some((statement) => {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement) ||
      ts.isExportDeclaration(statement)
    ) {
      return false;
    }
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isFunctionDeclaration(statement)
    ) {
      return false;
    }
    if (ts.isClassDeclaration(statement)) {
      return classHasEagerEffect(statement);
    }
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some((declaration) =>
        Boolean(
          declaration.initializer &&
          containsEagerEffect(declaration.initializer),
        ),
      );
    }
    if (ts.isExpressionStatement(statement)) {
      return containsEagerEffect(statement.expression);
    }
    if (ts.isEmptyStatement(statement)) return false;
    return true;
  });
}

function isEntirelyTypeOnlyImport(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  if (!clause) return false;
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return true;
  return Boolean(
    !clause.name &&
    clause.namedBindings &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every(
      (element) => element.isTypeOnly || hasDirectTypeKeyword(element),
    ),
  );
}

function isEntirelyTypeOnlyExport(statement: ts.ExportDeclaration): boolean {
  if (statement.isTypeOnly) return true;
  return Boolean(
    statement.exportClause &&
    ts.isNamedExports(statement.exportClause) &&
    statement.exportClause.elements.length > 0 &&
    statement.exportClause.elements.every(hasDirectTypeKeyword),
  );
}

function containsEagerEffect(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) ||
    ts.isNewExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isYieldExpression(node) ||
    ts.isDeleteExpression(node) ||
    ts.isTaggedTemplateExpression(node) ||
    ts.isThrowStatement(node) ||
    ts.isDebuggerStatement(node) ||
    ts.isWithStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  ) {
    return true;
  }
  if (
    ts.isBinaryExpression(node) &&
    isAssignmentOperator(node.operatorToken.kind)
  ) {
    return true;
  }
  if (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return true;
  }
  if (ts.isClassLike(node)) return classHasEagerEffect(node);
  if (ts.isFunctionLike(node)) return false;
  let found = false;
  node.forEachChild((child) => {
    if (!found && containsEagerEffect(child)) found = true;
  });
  return found;
}

function classHasEagerEffect(node: ts.ClassLikeDeclaration): boolean {
  if (node.modifiers?.some(ts.isDecorator)) {
    return true;
  }
  if (
    node.heritageClauses?.some((clause) =>
      clause.types.some((type) => containsEagerEffect(type.expression)),
    )
  ) {
    return true;
  }
  return node.members.some((member) => {
    if (
      member.name &&
      ts.isComputedPropertyName(member.name) &&
      containsEagerEffect(member.name.expression)
    ) {
      return true;
    }
    if (ts.isClassStaticBlockDeclaration(member)) {
      return member.body.statements.some((statement) =>
        containsEagerEffect(statement),
      );
    }
    return Boolean(
      ts.isPropertyDeclaration(member) &&
      member.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword,
      ) &&
      member.initializer &&
      containsEagerEffect(member.initializer),
    );
  });
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind >= ts.SyntaxKind.FirstAssignment &&
    kind <= ts.SyntaxKind.LastAssignment
  );
}

const allowedUiModelTypeExpressions: Readonly<
  Record<string, string | readonly string[]>
> = {
  AtlasItemKind: 'CoreAtlasItemKind',
  AtlasView: "'map'|'journal'",
  AtlasKindFilter: "'all'|AtlasItemKind",
  AtlasPersonalFilter: "'all'|'unvisited'|'visited'",
  PersonalState: 'CorePersonalState',
  VerificationStatus: 'CoreVerificationStatus',
  ReservationMode: 'CoreReservationMode',
  SourceLink: 'CoreSourceLink',
  TabelogSnapshot: 'CoreTabelogSnapshot',
  ReservationSnapshot: 'CoreReservationSnapshot',
  EventSchedule: 'CoreEventSchedule',
  AtlasItem: [
    'CoreAtlasItem',
    'CoreAtlasItem&{readonlyoverallComment?:string;}',
  ],
  AtlasItemEdit: 'CoreAtlasItemEdit',
  PlaceAssessment:
    "Omit<CorePlaceAssessment,'manualVisited'>&EffectiveVisitedProjection",
  PlaceAssessmentPatch:
    "Omit<CorePlaceAssessmentPatch,'manualVisited'>&EffectiveVisitedPatch",
  VisitRecord: 'CoreVisit',
  VisitMediaRecord:
    "Pick<CoreVisitMedia,|'id'|'visitId'|'itemId'|'originalFilename'|'contentType'|'caption'|'score'|'displayOrder'|'contentUrl'>",
  NewVisit: 'CoreNewVisit',
  VisitUpdate: "Omit<CoreVisitUpdate,'id'>",
  VisitCreateResult: 'CoreVisitMutationResult',
  VisitMutationResult:
    "Omit<CoreVisitMutationResult,'visit'>&Partial<Pick<CoreVisitMutationResult,'visit'>>",
};

const allowedUiModelInterfaces: Readonly<
  Record<string, Readonly<Record<string, { optional: boolean; type: string }>>>
> = {
  EffectiveVisitedProjection: {
    hasVisited: { optional: false, type: 'boolean' },
  },
  EffectiveVisitedPatch: {
    hasVisited: { optional: true, type: 'boolean' },
  },
  AtlasSummary: {
    saved: { optional: false, type: 'number' },
    timeSensitive: { optional: false, type: 'number' },
  },
};

function isAllowedUiModelDeclaration(statement: ts.Statement): boolean {
  if (ts.isTypeAliasDeclaration(statement)) {
    const expected = allowedUiModelTypeExpressions[statement.name.text];
    if (!expected) return false;
    const actual = compactTypeText(statement.type.getText());
    return typeof expected === 'string'
      ? actual === expected
      : expected.includes(actual);
  }
  if (!ts.isInterfaceDeclaration(statement)) return false;
  const expected = allowedUiModelInterfaces[statement.name.text];
  if (!expected || statement.heritageClauses?.length) return false;
  if (statement.members.length !== Object.keys(expected).length) return false;
  return statement.members.every((member) => {
    if (
      !ts.isPropertySignature(member) ||
      !member.type ||
      !member.name ||
      !member.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
      )
    ) {
      return false;
    }
    const name = propertyName(member.name);
    const shape = name ? expected[name] : undefined;
    return Boolean(
      shape &&
      Boolean(member.questionToken) === shape.optional &&
      compactTypeText(member.type.getText()) === shape.type,
    );
  });
}

function compactTypeText(value: string): string {
  return value.replace(/\s+/gu, '');
}

function isAllowedRatingParser(statement: ts.FunctionDeclaration): boolean {
  if (
    statement.name?.text !== 'parseOptionalRating' ||
    statement.parameters.length !== 1 ||
    !ts.isIdentifier(statement.parameters[0].name) ||
    statement.parameters[0].name.text !== 'value' ||
    !statement.body ||
    statement.body.statements.length !== 2
  ) {
    return false;
  }
  const [trimStatement, returnStatement] = statement.body.statements;
  if (
    !ts.isVariableStatement(trimStatement) ||
    (trimStatement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
    trimStatement.declarationList.declarations.length !== 1
  ) {
    return false;
  }
  const declaration = trimStatement.declarationList.declarations[0];
  const trimCall = unwrapExpression(declaration.initializer);
  if (
    !ts.isIdentifier(declaration.name) ||
    declaration.name.text !== 'trimmed' ||
    !trimCall ||
    !ts.isCallExpression(trimCall) ||
    trimCall.arguments.length !== 0 ||
    !ts.isPropertyAccessExpression(trimCall.expression) ||
    trimCall.expression.name.text !== 'trim' ||
    !ts.isIdentifier(trimCall.expression.expression) ||
    trimCall.expression.expression.text !== 'value'
  ) {
    return false;
  }
  if (!ts.isReturnStatement(returnStatement)) return false;
  const result = unwrapExpression(returnStatement.expression);
  if (!result || !ts.isConditionalExpression(result)) return false;
  const condition = unwrapExpression(result.condition);
  const whenTrue = unwrapExpression(result.whenTrue);
  const whenFalse = unwrapExpression(result.whenFalse);
  if (
    !condition ||
    !ts.isBinaryExpression(condition) ||
    condition.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
    !ts.isIdentifier(condition.left) ||
    condition.left.text !== 'trimmed' ||
    !ts.isStringLiteral(condition.right) ||
    condition.right.text !== '' ||
    !whenTrue ||
    !ts.isIdentifier(whenTrue) ||
    whenTrue.text !== 'undefined' ||
    !whenFalse ||
    !ts.isCallExpression(whenFalse) ||
    !ts.isIdentifier(whenFalse.expression) ||
    whenFalse.expression.text !== 'normalizeAssessmentRating' ||
    whenFalse.arguments.length !== 1
  ) {
    return false;
  }
  const numberCall = unwrapExpression(whenFalse.arguments[0]);
  return Boolean(
    numberCall &&
    ts.isCallExpression(numberCall) &&
    ts.isIdentifier(numberCall.expression) &&
    numberCall.expression.text === 'Number' &&
    numberCall.arguments.length === 1 &&
    ts.isIdentifier(numberCall.arguments[0]) &&
    numberCall.arguments[0].text === 'trimmed',
  );
}

function collectModuleReferences(source: ts.SourceFile): ModuleReference[] {
  const references: ModuleReference[] = [];
  walk(source, (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        references.push(moduleReference(node.moduleSpecifier, source));
      }
      return;
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      references.push(moduleReference(node.moduleReference.expression, source));
      return;
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      references.push(
        node.arguments.length === 1
          ? moduleReference(node.arguments[0], source)
          : { text: node.getText(source) },
      );
      return;
    }
    if (ts.isImportTypeNode(node)) {
      const argument = ts.isLiteralTypeNode(node.argument)
        ? node.argument.literal
        : node.argument;
      references.push(moduleReference(argument, source));
    }
  });
  return references;
}

function collectRuntimeModuleReferences(
  source: ts.SourceFile,
): ModuleReference[] {
  const references: ModuleReference[] = [];
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      !isEntirelyTypeOnlyImport(statement)
    ) {
      references.push(moduleReference(statement.moduleSpecifier, source));
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      !isEntirelyTypeOnlyExport(statement)
    ) {
      references.push(moduleReference(statement.moduleSpecifier, source));
      continue;
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      !statement.isTypeOnly &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression
    ) {
      references.push(
        moduleReference(statement.moduleReference.expression, source),
      );
    }
  }
  walk(source, (node) => {
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      references.push(
        node.arguments.length === 1
          ? moduleReference(node.arguments[0], source)
          : { text: node.getText(source) },
      );
    }
  });
  return references;
}

function moduleReference(
  expression: ts.Node,
  source: ts.SourceFile,
): ModuleReference {
  return ts.isStringLiteral(expression)
    ? { specifier: expression.text, text: expression.getText(source) }
    : { text: expression.getText(source) };
}

function staticProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      !ts.isComputedPropertyName(property.name) &&
      propertyName(property.name) === name,
  );
}

function stringProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): string | undefined {
  const property = staticProperty(object, name);
  const initializer = property && unwrapExpression(property.initializer);
  return initializer && ts.isStringLiteral(initializer)
    ? initializer.text
    : undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isComputedPropertyName(name)) return undefined;
  return ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

function literalTypeArgument(
  type: ts.TypeNode,
  index: number,
): string | undefined {
  if (!ts.isTypeReferenceNode(type)) return undefined;
  const argument = type.typeArguments?.[index];
  return argument &&
    ts.isLiteralTypeNode(argument) &&
    ts.isStringLiteral(argument.literal)
    ? argument.literal.text
    : undefined;
}

function isOperationDefinitionType(
  type: ts.TypeNode | undefined,
): type is ts.TypeReferenceNode {
  return Boolean(
    type &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === 'OperationDefinition',
  );
}

function unwrapExpression(
  expression: ts.Expression | undefined,
): ts.Expression | undefined {
  let current = expression;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function resolveLocalExpression(
  expression: ts.Expression,
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  seen: ReadonlySet<ts.Symbol> = new Set(),
): ts.Expression | undefined {
  const unwrapped = unwrapExpression(expression);
  if (!unwrapped || !ts.isIdentifier(unwrapped)) return unwrapped;
  const symbol = checker.getSymbolAtLocation(unwrapped);
  if (!symbol || seen.has(symbol)) return undefined;
  const declarations = (symbol.declarations ?? []).filter(
    (declaration): declaration is ts.VariableDeclaration =>
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined &&
      path.normalize(declaration.getSourceFile().fileName) ===
        path.normalize(source.fileName) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0,
  );
  const initializer =
    declarations.length === 1 ? declarations[0].initializer : undefined;
  return initializer
    ? resolveLocalExpression(
        initializer,
        source,
        checker,
        new Set([...seen, symbol]),
      )
    : undefined;
}

function resolveLocalGroupCall(
  expression: ts.Expression | undefined,
  source: ts.SourceFile,
  checker: ts.TypeChecker,
): ts.CallExpression | undefined {
  if (!expression) return undefined;
  const resolved = resolveLocalExpression(expression, source, checker);
  return resolved && ts.isCallExpression(resolved) ? resolved : undefined;
}

function findBoundOperationGroup(
  identifier: ts.Identifier,
  file: ParsedFile,
  checker: ts.TypeChecker,
  groups: ReadonlyMap<string, OperationGroupDefinition>,
  manifest: ArchitectureFitnessManifest,
): OperationGroupDefinition | undefined {
  const symbol = resolveAliasTerminalSymbol(identifier, file.source, checker);
  if (!symbol) return undefined;
  const importSpecifier = symbol.declarations?.find(ts.isImportSpecifier);
  if (importSpecifier) {
    const importDeclaration = nearestAncestor(
      importSpecifier,
      ts.isImportDeclaration,
    );
    const importedName =
      importSpecifier.propertyName?.text ?? importSpecifier.name.text;
    const group = groups.get(importedName);
    return importDeclaration &&
      group &&
      ts.isStringLiteral(importDeclaration.moduleSpecifier) &&
      resolveImport(
        manifest.webRoot,
        file.filename,
        importDeclaration.moduleSpecifier.text,
      ) === path.normalize(group.file.filename)
      ? group
      : undefined;
  }
  const declaration = symbol.declarations?.find(ts.isFunctionDeclaration);
  if (!declaration) return undefined;
  return [...groups.values()].find(
    (group) =>
      path.normalize(group.file.filename) ===
        path.normalize(declaration.getSourceFile().fileName) &&
      group.declarationStart ===
        declaration.getStart(declaration.getSourceFile()),
  );
}

function nearestAncestor<T extends ts.Node>(
  node: ts.Node,
  predicate: (node: ts.Node) => node is T,
): T | undefined {
  let parent = node.parent;
  while (parent) {
    if (predicate(parent)) return parent;
    parent = parent.parent;
  }
  return undefined;
}

function operationDefinitionId(
  definition: Pick<OperationDescriptor, 'filename' | 'variableName'>,
): string {
  return `${path.normalize(definition.filename)}#${definition.variableName}`;
}

function findBoundOperationDefinition(
  identifier: ts.Identifier,
  definitions: ReadonlyMap<string, OperationDescriptor>,
  source: ts.SourceFile,
  checker: ts.TypeChecker,
): OperationDescriptor | undefined {
  const symbol = resolveAliasTerminalSymbol(identifier, source, checker);
  const declaration = symbol?.declarations?.find(ts.isVariableDeclaration);
  if (!declaration) return undefined;
  return [...definitions.values()].find(
    (definition) =>
      path.normalize(declaration.getSourceFile().fileName) ===
        path.normalize(definition.filename) &&
      declaration.getStart(declaration.getSourceFile()) ===
        definition.declarationStart,
  );
}

function isImportedBindingFrom(
  identifier: ts.Identifier,
  importedName: string,
  expectedSource: string,
  file: ParsedFile,
  checker: ts.TypeChecker,
  manifest: ArchitectureFitnessManifest,
): boolean {
  const symbol = resolveAliasTerminalSymbol(identifier, file.source, checker);
  const specifier = symbol?.declarations?.find(ts.isImportSpecifier);
  const declaration = specifier
    ? nearestAncestor(specifier, ts.isImportDeclaration)
    : undefined;
  return Boolean(
    specifier &&
    declaration &&
    ts.isStringLiteral(declaration.moduleSpecifier) &&
    (specifier.propertyName?.text ?? specifier.name.text) === importedName &&
    resolveImport(
      manifest.webRoot,
      file.filename,
      declaration.moduleSpecifier.text,
    ) === path.normalize(expectedSource),
  );
}

function resolveAliasTerminalSymbol(
  identifier: ts.Identifier,
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  seen: ReadonlySet<ts.Symbol> = new Set(),
): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (!symbol || seen.has(symbol)) return undefined;
  const declarations = symbol.declarations ?? [];
  if (declarations.some(ts.isImportSpecifier)) return symbol;
  const variableDeclarations = declarations.filter(ts.isVariableDeclaration);
  if (variableDeclarations.length === 0) return symbol;
  if (variableDeclarations.length !== 1) return undefined;
  const declaration = variableDeclarations[0];
  if (
    path.normalize(declaration.getSourceFile().fileName) !==
      path.normalize(source.fileName) ||
    !declaration.initializer ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    (declaration.parent.flags & ts.NodeFlags.Const) === 0
  ) {
    return undefined;
  }
  const initializer = unwrapExpression(declaration.initializer);
  if (!initializer || !ts.isIdentifier(initializer)) return symbol;
  return resolveAliasTerminalSymbol(
    initializer,
    source,
    checker,
    new Set([...seen, symbol]),
  );
}

function importsIdentifierFrom(
  file: ParsedFile,
  name: string,
  expectedSource: string,
  manifest: ArchitectureFitnessManifest,
): boolean {
  return file.source.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return false;
    }
    const importsName = Boolean(
      statement.importClause?.name?.text === name ||
      (statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(
          (element) =>
            (element.propertyName?.text ?? element.name.text) === name,
        )),
    );
    return (
      importsName &&
      resolveImport(
        manifest.webRoot,
        file.filename,
        statement.moduleSpecifier.text,
      ) === path.normalize(expectedSource)
    );
  });
}

function sourceStringFragments(source: ts.SourceFile): string[] {
  const values: string[] = [];
  walk(source, (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      values.push(node.text);
    }
  });
  return values;
}

function evaluateStaticString(
  expression: ts.Expression,
  source: ts.SourceFile,
  seen: ReadonlySet<string> = new Set(),
): string | undefined {
  const value = unwrapExpression(expression);
  if (!value) return undefined;
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text;
  }
  if (
    ts.isBinaryExpression(value) &&
    value.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = evaluateStaticString(value.left, source, seen);
    const right = evaluateStaticString(value.right, source, seen);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  if (ts.isTemplateExpression(value)) {
    let result = value.head.text;
    for (const span of value.templateSpans) {
      const replacement = evaluateStaticString(span.expression, source, seen);
      if (replacement === undefined) return undefined;
      result += replacement + span.literal.text;
    }
    return result;
  }
  if (ts.isIdentifier(value) && !seen.has(value.text)) {
    let initializer: ts.Expression | undefined;
    walk(source, (node) => {
      if (
        !initializer &&
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === value.text &&
        node.initializer
      ) {
        initializer = node.initializer;
      }
    });
    return initializer
      ? evaluateStaticString(
          initializer,
          source,
          new Set([...seen, value.text]),
        )
      : undefined;
  }
  return undefined;
}

function hasDirectOperationsArray(source: ts.SourceFile): boolean {
  let found = false;
  walk(source, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return;
    const property = staticProperty(node, 'operations');
    const initializer = property && unwrapExpression(property.initializer);
    if (initializer && ts.isArrayLiteralExpression(initializer)) found = true;
  });
  return found;
}

function implementedFunctionName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name && node.body) {
    return node.name.text;
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer))
  ) {
    return node.name.text;
  }
  return undefined;
}

function isSearchPrimitive(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'normalize' &&
    node.arguments.length === 1 &&
    ts.isStringLiteral(node.arguments[0]) &&
    node.arguments[0].text === 'NFKC'
  ) {
    return true;
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'includes' &&
    containsNode(
      node,
      (candidate) =>
        ts.isCallExpression(candidate) &&
        ts.isPropertyAccessExpression(candidate.expression) &&
        (candidate.expression.name.text === 'toLowerCase' ||
          candidate.expression.name.text === 'toLocaleLowerCase'),
    )
  ) {
    return true;
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'split' &&
    node.arguments.some(
      (argument) =>
        ts.isRegularExpressionLiteral(argument) &&
        argument.text.includes('\\s+'),
    )
  ) {
    return true;
  }
  if (
    ts.isRegularExpressionLiteral(node) &&
    node.text.includes('\\p{P}') &&
    node.text.includes('\\p{S}')
  ) {
    return true;
  }
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'slice' &&
    node.arguments.length >= 2 &&
    ts.isBinaryExpression(node.arguments[1]) &&
    node.arguments[1].operatorToken.kind === ts.SyntaxKind.PlusToken &&
    isNumber(node.arguments[1].right, 2)
  );
}

function isRatingPrimitive(node: ts.Node): boolean {
  const roundToTenth =
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'Math' &&
    ['round', 'floor', 'ceil', 'trunc'].includes(node.expression.name.text) &&
    containsNode(
      node,
      (candidate) =>
        ts.isBinaryExpression(candidate) &&
        candidate.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
        (isNumber(candidate.left, 10) || isNumber(candidate.right, 10)),
    );
  if (roundToTenth) return true;
  return Boolean(
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'toFixed' &&
    node.arguments.length === 1 &&
    isNumber(node.arguments[0], 1) &&
    ((ts.isCallExpression(node.parent) &&
      ts.isIdentifier(node.parent.expression) &&
      ['Number', 'parseFloat'].includes(node.parent.expression.text)) ||
      (ts.isPrefixUnaryExpression(node.parent) &&
        node.parent.operator === ts.SyntaxKind.PlusToken)),
  );
}

function isEffectiveVisitedPrimitive(node: ts.Node): boolean {
  if (ts.isConditionalExpression(node)) {
    return (
      (isBooleanProjection(node.condition) &&
        isTrueLiteral(node.whenTrue) &&
        isPositiveCount(node.whenFalse)) ||
      (isBooleanProjection(node.condition) &&
        isPositiveCount(node.whenTrue) &&
        isTrueLiteral(node.whenFalse))
    );
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    return (
      (isBooleanProjection(node.left) &&
        (isPositiveCount(node.right) || isCountProjection(node.right))) ||
      (isBooleanProjection(node.right) &&
        (isPositiveCount(node.left) || isCountProjection(node.left)))
    );
  }
  if (ts.isIfStatement(node) && isBooleanProjection(node.expression)) {
    const functionNode = nearestFunction(node);
    return Boolean(
      functionNode &&
      containsNode(node.thenStatement, isTrueReturn) &&
      containsNode(functionNode, (candidate) =>
        ts.isExpression(candidate) ? isPositiveCount(candidate) : false,
      ),
    );
  }
  return false;
}

function isSearchHeuristicScope(
  filename: string,
  manifest: ArchitectureFitnessManifest,
): boolean {
  const relativePath = relative(manifest, filename);
  return /^(?:app|features|lib)\//u.test(relativePath);
}

function hasSearchPipelineVariant(source: ts.SourceFile): boolean {
  let hasLowercase = false;
  let hasMatchOrSegmentation = false;
  walk(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'toLowerCase' ||
        node.expression.name.text === 'toLocaleLowerCase')
    ) {
      hasLowercase = true;
    }
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      ['includes', 'some', 'every', 'segment'].includes(
        node.expression.name.text,
      )
    ) {
      hasMatchOrSegmentation = true;
    }
  });
  return hasLowercase && hasMatchOrSegmentation;
}

function nearestFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  let parent = node.parent;
  while (parent) {
    if (ts.isFunctionLike(parent)) return parent;
    parent = parent.parent;
  }
  return undefined;
}

function isTrueReturn(node: ts.Node): boolean {
  return Boolean(
    ts.isReturnStatement(node) &&
    node.expression &&
    isTrueLiteral(node.expression),
  );
}

function isTrueLiteral(node: ts.Expression): boolean {
  return unwrapExpression(node)?.kind === ts.SyntaxKind.TrueKeyword;
}

function isCountProjection(node: ts.Expression): boolean {
  const expression = unwrapExpression(node);
  return Boolean(
    expression &&
    (ts.isIdentifier(expression) ||
      ts.isPropertyAccessExpression(expression)) &&
    /(?:^|\.)(?:[A-Za-z]*Count|[A-Za-z]*Visits?|count|visits?|length)$/u.test(
      expression.getText(),
    ),
  );
}

function isBooleanProjection(node: ts.Expression): boolean {
  const expression = unwrapExpression(node);
  return Boolean(
    expression &&
    (ts.isIdentifier(expression) ||
      ts.isPropertyAccessExpression(expression) ||
      (ts.isCallExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'Boolean' &&
        expression.arguments.length === 1)),
  );
}

function isPositiveCount(node: ts.Expression): boolean {
  const expression = unwrapExpression(node);
  return Boolean(
    expression &&
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.GreaterThanToken &&
    isNumber(expression.right, 0) &&
    (ts.isIdentifier(expression.left) ||
      ts.isPropertyAccessExpression(expression.left) ||
      ts.isCallExpression(expression.left)),
  );
}

function isNumber(node: ts.Expression, value: number): boolean {
  const expression = unwrapExpression(node);
  return Boolean(
    expression &&
    ts.isNumericLiteral(expression) &&
    Number(expression.text) === value,
  );
}

function containsNode(
  node: ts.Node,
  predicate: (node: ts.Node) => boolean,
): boolean {
  if (predicate(node)) return true;
  let found = false;
  node.forEachChild((child) => {
    if (!found && containsNode(child, predicate)) found = true;
  });
  return found;
}

function containsTypeLiteral(node: ts.Node): boolean {
  return containsNode(node, ts.isTypeLiteralNode);
}

function createSemanticSource(filename: string): SemanticSource {
  const program = ts.createProgram([filename], {
    allowJs: false,
    module: ts.ModuleKind.ESNext,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
  });
  const source = program.getSourceFile(filename);
  if (!source) {
    throw new Error('Unable to create semantic source: source-unavailable');
  }
  return { source, checker: program.getTypeChecker() };
}

function resolvesToAnySymbol(
  identifier: ts.Identifier,
  bindings: ReadonlySet<ts.Symbol>,
  source: ts.SourceFile,
  checker: ts.TypeChecker,
): boolean {
  const symbol = resolveAliasTerminalSymbol(identifier, source, checker);
  return Boolean(symbol && bindings.has(symbol));
}

function parseFile(filename: string): ParsedFile {
  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const diagnostics = (
    source as ts.SourceFile & {
      readonly parseDiagnostics?: readonly ts.Diagnostic[];
    }
  ).parseDiagnostics;
  return {
    filename: path.normalize(filename),
    source,
    diagnostics: diagnostics ?? [],
  };
}

function productionFilesIn(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const filename = path.normalize(path.join(directory, entry.name));
    if (entry.isDirectory()) return productionFilesIn(filename);
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return [];
    return entry.name.includes('.test.') || entry.name.includes('.typecheck.')
      ? []
      : [filename];
  });
}

function resolveImport(
  webRoot: string,
  importer: string,
  specifier: string,
): string | undefined {
  const absolute = specifier.startsWith('@/')
    ? path.join(webRoot, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(importer), specifier)
      : undefined;
  if (!absolute) return undefined;
  const stripped = stripKnownExtension(absolute);
  for (const candidate of [
    absolute,
    stripped,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    path.join(stripped, 'index.ts'),
    path.join(stripped, 'index.tsx'),
  ]) {
    if (existsSync(candidate)) return path.normalize(candidate);
  }
  return undefined;
}

function stripKnownExtension(filename: string): string {
  return filename.replace(/\.(?:[cm]?[jt]sx?)$/u, '');
}

function isOperationModule(filename: string): boolean {
  return path.basename(stripKnownExtension(filename)).endsWith('-operations');
}

function findCycle(graph: ReadonlyMap<string, readonly string[]>): string[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (node: string): string[] => {
    if (visiting.has(node)) return [...stack.slice(stack.indexOf(node)), node];
    if (visited.has(node)) return [];
    visiting.add(node);
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) {
      const cycle = visit(dependency);
      if (cycle.length) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return [];
  };
  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle.length) return cycle;
  }
  return [];
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function isWithin(filename: string, directory: string): boolean {
  const relativePath = path.relative(path.normalize(directory), filename);
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

function relative(
  manifest: ArchitectureFitnessManifest,
  filename: string,
): string {
  return path.relative(manifest.webRoot, filename);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function addViolation(
  violations: ArchitectureViolation[],
  violation: ArchitectureViolation,
): void {
  const fingerprint = `${violation.rule}:${violation.file ?? ''}:${violation.detail}`;
  if (
    !violations.some(
      (current) =>
        `${current.rule}:${current.file ?? ''}:${current.detail}` ===
        fingerprint,
    )
  ) {
    violations.push(violation);
  }
}

function sanitizeArchitectureViolations(
  manifest: ArchitectureFitnessManifest,
  violations: readonly ArchitectureViolation[],
): readonly ArchitectureViolation[] {
  const sanitized: ArchitectureViolation[] = [];
  for (const violation of violations) {
    addViolation(sanitized, {
      rule: violation.rule,
      file: violation.file
        ? sanitizePathOrSpecifier(manifest, violation.file, 'file')
        : undefined,
      detail: sanitizePathOrSpecifier(manifest, violation.detail),
    });
  }
  return sanitized;
}

function sanitizePathOrSpecifier(
  manifest: ArchitectureFitnessManifest,
  value: string,
  field: 'detail' | 'file' = 'detail',
): string {
  const trimmed = value.trim();
  if (
    trimmed === '<absolute:redacted>' ||
    trimmed === '<external-path:redacted>' ||
    trimmed === '<detail:redacted>' ||
    trimmed === '<path:redacted>'
  ) {
    return trimmed;
  }
  const classification = classifyPathText(trimmed);
  if (classification.kind !== 'plain') {
    return formatPathClassification(manifest, classification);
  }
  if (field === 'detail' && isSafeDiagnosticIdentifier(trimmed)) return trimmed;
  const repositoryPath = provenRepositoryRelativeInput(manifest, trimmed);
  return (
    repositoryPath ??
    (field === 'file' ? '<path:redacted>' : '<detail:redacted>')
  );
}

type PathClassification =
  | { readonly kind: 'absolute'; readonly filesystemPath?: string }
  | { readonly kind: 'plain'; readonly value: string }
  | { readonly kind: 'traversal' };

function classifyPathText(value: string): PathClassification {
  if (/^file:\/\//iu.test(value)) {
    try {
      const url = new URL(value);
      return {
        kind: 'absolute',
        filesystemPath: url.search || url.hash ? undefined : fileURLToPath(url),
      };
    } catch {
      return { kind: 'absolute' };
    }
  }
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return {
      kind: 'absolute',
      filesystemPath:
        path.isAbsolute(value) && !/[?#]/u.test(value) ? value : undefined,
    };
  }
  if (/^(?:\.\.(?:[\\/]|$))+/u.test(value)) {
    return { kind: 'traversal' };
  }
  return { kind: 'plain', value };
}

function formatPathClassification(
  manifest: ArchitectureFitnessManifest,
  classification: Exclude<PathClassification, { readonly kind: 'plain' }>,
): string {
  if (classification.kind === 'traversal') {
    return '<external-path:redacted>';
  }
  if (classification.filesystemPath) {
    const repositoryPath = provenRepositoryRelativePath(
      manifest,
      classification.filesystemPath,
    );
    if (repositoryPath) return repositoryPath;
  }
  return '<absolute:redacted>';
}

function provenRepositoryRelativePath(
  manifest: ArchitectureFitnessManifest,
  filename: string,
): string | undefined {
  try {
    const repositoryRoot = realpathSync(manifest.webRoot);
    const realFilename = realpathSync(filename);
    if (!isWithin(realFilename, repositoryRoot)) return undefined;
    return path
      .relative(repositoryRoot, realFilename)
      .split(path.sep)
      .join('/');
  } catch {
    return undefined;
  }
}

function provenRepositoryRelativeInput(
  manifest: ArchitectureFitnessManifest,
  value: string,
): string | undefined {
  if (!value.includes('/') && !value.includes('\\')) return undefined;
  if (/[?#\n\r]/u.test(value) || value.includes(String.fromCharCode(0))) {
    return undefined;
  }
  return provenRepositoryRelativePath(
    manifest,
    path.resolve(manifest.webRoot, value),
  );
}

function safeModuleSpecifierDetail(
  manifest: ArchitectureFitnessManifest,
  importer: string,
  specifier: string,
): string {
  const classification = classifyPathText(specifier);
  if (classification.kind !== 'plain') {
    return formatPathClassification(manifest, classification);
  }
  if (specifier === '<absolute:redacted>') return specifier;
  const resolved = isLocalModuleSpecifier(specifier)
    ? resolveImport(manifest.webRoot, importer, specifier)
    : undefined;
  const repositoryPath = resolved
    ? provenRepositoryRelativePath(manifest, resolved)
    : undefined;
  if (repositoryPath) return repositoryPath;
  if (/^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+$/u.test(specifier)) {
    return 'package-reference';
  }
  return 'module-reference-redacted';
}

function safeDiagnosticIdentifier(value: string, fallback: string): string {
  return isSafeDiagnosticIdentifier(value) ? value : fallback;
}

function isSafeDiagnosticIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_$.-]+(?::[A-Za-z0-9_$.-]+)*$/u.test(value);
}
