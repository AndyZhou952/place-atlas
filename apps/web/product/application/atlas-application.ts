import { failure, type Result } from './result.ts';

export type OperationResultKind = 'json' | 'media_stream';
export type OperationEffect = 'read' | 'write' | 'destructive';

export interface MediaContent {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly byteSize: number;
  readonly etag?: string;
}

export interface OperationDescriptor<
  Key extends string,
  Input,
  Kind extends OperationResultKind,
> {
  readonly key: Key;
  readonly resultKind: Kind;
  readonly effect: OperationEffect;
  readonly validate: (input: unknown) => Result<Input>;
}

interface OperationDefinitionShape<
  Key extends string,
  Input,
  Output,
  Kind extends OperationResultKind,
> {
  readonly descriptor: OperationDescriptor<Key, Input, Kind>;
  readonly handle: (
    input: Input,
    context?: ApplicationExecutionContext,
  ) => Promise<Result<Output>>;
}

export type OperationDefinition<
  Key extends string,
  Input,
  Output,
  Kind extends OperationResultKind,
> = [Kind] extends ['media_stream']
  ? [Output] extends [MediaContent]
    ? OperationDefinitionShape<Key, Input, Output, Kind>
    : never
  : OperationDefinitionShape<Key, Input, Output, Kind>;

type DefinitionParts<Definition> =
  Definition extends OperationDefinitionShape<
    infer Key,
    infer Input,
    infer Output,
    infer Kind
  >
    ? {
        readonly key: Key;
        readonly input: Input;
        readonly output: Output;
        readonly kind: Kind;
      }
    : never;

type OperationKey<Definitions> = keyof Definitions & string;

export type JsonOperationKey<Definitions> = {
  [Key in OperationKey<Definitions>]: DefinitionParts<
    Definitions[Key]
  >['kind'] extends 'json'
    ? Key
    : never;
}[OperationKey<Definitions>];

export type MediaOperationKey<Definitions> = {
  [Key in OperationKey<Definitions>]: DefinitionParts<
    Definitions[Key]
  >['kind'] extends 'media_stream'
    ? Key
    : never;
}[OperationKey<Definitions>];

type InputOf<
  Definitions,
  Key extends OperationKey<Definitions>,
> = DefinitionParts<Definitions[Key]>['input'];

type OutputOf<
  Definitions,
  Key extends OperationKey<Definitions>,
> = DefinitionParts<Definitions[Key]>['output'];

export interface TypedOperation<
  Definitions,
  Key extends OperationKey<Definitions>,
> {
  readonly key: Key;
  readonly input: InputOf<Definitions, Key>;
}

export interface AtlasApplication<Definitions> {
  execute<Key extends JsonOperationKey<Definitions>>(
    operation: TypedOperation<Definitions, Key>,
    context?: ApplicationExecutionContext,
  ): Promise<Result<OutputOf<Definitions, Key>>>;
  openMedia<Key extends MediaOperationKey<Definitions>>(
    operation: TypedOperation<Definitions, Key>,
  ): Promise<Result<OutputOf<Definitions, Key>>>;
  normalize<Key extends JsonOperationKey<Definitions>>(
    operation: TypedOperation<Definitions, Key>,
  ): Result<TypedOperation<Definitions, Key>>;
  executePrepared<Key extends JsonOperationKey<Definitions>>(
    operation: TypedOperation<Definitions, Key>,
    context?: ApplicationExecutionContext,
  ): Promise<Result<OutputOf<Definitions, Key>>>;
}

export interface AtomicMutationCommit {
  readonly principal: string;
  readonly mutationId: string;
  readonly payloadDigest: string;
  readonly attemptToken: string;
  readonly result: unknown;
  readonly committedAtMs: number;
}

export interface ApplicationExecutionContext {
  readonly atomicMutation?: {
    readonly receiptFor: (result: unknown) => AtomicMutationCommit;
  };
}

type CheckedDefinitions<Definitions> = {
  readonly [Key in keyof Definitions]: Definitions[Key] extends OperationDefinitionShape<
    Key & string,
    infer Input,
    infer Output,
    infer Kind
  >
    ? OperationDefinition<Key & string, Input, Output, Kind>
    : never;
};

export function defineOperationGroup<const Definitions>(
  definitions: Definitions & CheckedDefinitions<Definitions>,
): Definitions {
  return definitions;
}

export function createAtlasApplication<const Definitions extends object>(
  definitions: Definitions & CheckedDefinitions<Definitions>,
): AtlasApplication<Definitions> {
  return {
    execute: (operation, context) =>
      dispatch(definitions, operation, 'json', context),
    openMedia: (operation) => dispatch(definitions, operation, 'media_stream'),
    normalize: (operation) => normalize(definitions, operation, 'json'),
    executePrepared: (operation, context) =>
      dispatchPrepared(definitions, operation, 'json', context),
  };
}

interface RuntimeDefinition {
  readonly descriptor: {
    readonly key: string;
    readonly resultKind: OperationResultKind;
    readonly validate: (input: unknown) => Result<unknown>;
  };
  readonly handle: (
    input: unknown,
    context?: ApplicationExecutionContext,
  ) => Promise<Result<unknown>>;
}

async function dispatch<
  Definitions extends object,
  Key extends OperationKey<Definitions>,
>(
  definitions: Definitions,
  operation: TypedOperation<Definitions, Key>,
  resultKind: OperationResultKind,
  context?: ApplicationExecutionContext,
): Promise<Result<OutputOf<Definitions, Key>>> {
  try {
    const prepared = normalize(definitions, operation, resultKind);
    if (!prepared.ok) return prepared;
    return await dispatchPrepared(
      definitions,
      prepared.value,
      resultKind,
      context,
    );
  } catch {
    return failure(
      'unexpected_failure',
      'The application operation could not be completed.',
    );
  }
}

async function dispatchPrepared<
  Definitions extends object,
  Key extends OperationKey<Definitions>,
>(
  definitions: Definitions,
  operation: TypedOperation<Definitions, Key>,
  resultKind: OperationResultKind,
  context?: ApplicationExecutionContext,
): Promise<Result<OutputOf<Definitions, Key>>> {
  const candidate = (definitions as Record<string, unknown>)[operation.key];
  if (!isRuntimeDefinition(candidate, operation.key, resultKind)) {
    return unavailableOperation();
  }
  return (await candidate.handle(operation.input, context)) as Result<
    OutputOf<Definitions, Key>
  >;
}

function normalize<
  Definitions extends object,
  Key extends OperationKey<Definitions>,
>(
  definitions: Definitions,
  operation: TypedOperation<Definitions, Key>,
  resultKind: OperationResultKind,
): Result<TypedOperation<Definitions, Key>> {
  try {
    const candidate = (definitions as Record<string, unknown>)[operation.key];
    if (!isRuntimeDefinition(candidate, operation.key, resultKind)) {
      return unavailableOperation();
    }
    const validated = candidate.descriptor.validate(operation.input);
    return validated.ok
      ? ({
          ok: true,
          value: { key: operation.key, input: validated.value },
        } as Result<TypedOperation<Definitions, Key>>)
      : validated;
  } catch {
    return failure(
      'unexpected_failure',
      'The application operation could not be completed.',
    );
  }
}

function unavailableOperation(): Result<never> {
  return failure(
    'unexpected_failure',
    'The requested application operation is unavailable.',
  );
}

function isRuntimeDefinition(
  value: unknown,
  key: string,
  resultKind: OperationResultKind,
): value is RuntimeDefinition {
  if (!value || typeof value !== 'object') return false;
  const definition = value as Partial<RuntimeDefinition>;
  return (
    definition.descriptor?.key === key &&
    definition.descriptor.resultKind === resultKind &&
    typeof definition.descriptor.validate === 'function' &&
    typeof definition.handle === 'function'
  );
}
