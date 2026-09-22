import {
  createAtlasApplication,
  defineOperationGroup,
  type MediaContent,
  type OperationDefinition,
} from './atlas-application.ts';
import {
  applicationErrorKinds,
  failure,
  success,
  type ApplicationErrorKind,
} from './result.ts';

type EmptyInput = Readonly<Record<string, never>>;

const jsonOperation: OperationDefinition<
  'fixture.json',
  EmptyInput,
  { readonly value: string },
  'json'
> = {
  descriptor: {
    key: 'fixture.json',
    resultKind: 'json',
    effect: 'read',
    validate: () => success({}),
  },
  async handle() {
    return success({ value: 'ok' });
  },
};

const mediaOperation: OperationDefinition<
  'fixture.media',
  EmptyInput,
  MediaContent,
  'media_stream'
> = {
  descriptor: {
    key: 'fixture.media',
    resultKind: 'media_stream',
    effect: 'read',
    validate: () => success({}),
  },
  async handle() {
    return success({
      body: new ReadableStream<Uint8Array>(),
      contentType: 'image/png',
      byteSize: 0,
    });
  },
};

// @ts-expect-error A media operation must produce the MediaContent envelope.
const invalidMediaOperation: OperationDefinition<
  'fixture.invalid-media',
  EmptyInput,
  string,
  'media_stream'
> = {
  descriptor: {
    key: 'fixture.invalid-media',
    resultKind: 'media_stream',
    effect: 'read',
    validate: () => success({}),
  },
  async handle() {
    return success('not a media envelope');
  },
};

void invalidMediaOperation;

const fixtureApplication = createAtlasApplication(
  defineOperationGroup({
    'fixture.json': jsonOperation,
    'fixture.media': mediaOperation,
  }),
);

void fixtureApplication.execute({ key: 'fixture.json', input: {} });
void fixtureApplication.openMedia({ key: 'fixture.media', input: {} });

// @ts-expect-error A media operation cannot use the JSON entry point.
void fixtureApplication.execute({ key: 'fixture.media', input: {} });
// @ts-expect-error A JSON operation cannot use the media entry point.
void fixtureApplication.openMedia({ key: 'fixture.json', input: {} });

const exhaustiveErrorLabels = {
  invalid_input: 'Invalid input',
  not_found: 'Not found',
  conflict: 'Conflict',
  dependency_failure: 'Dependency failure',
  unexpected_failure: 'Unexpected failure',
} satisfies Record<ApplicationErrorKind, string>;

void exhaustiveErrorLabels;
void applicationErrorKinds;
// @ts-expect-error Unauthorized is deliberately outside this feature's errors.
void failure('unauthorized', 'Not part of the closed error set');
