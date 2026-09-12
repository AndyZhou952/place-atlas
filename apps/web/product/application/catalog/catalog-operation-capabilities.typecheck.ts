import {
  createCatalogOperationGroup,
  createCatalogReadOperationGroup,
} from './catalog-operations.ts';
import type { CatalogRead } from './catalog-read.ts';
import type { JsonOperationKey } from '../atlas-application.ts';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

declare const catalog: CatalogRead;

type ReadOnlyKeys = JsonOperationKey<
  ReturnType<typeof createCatalogReadOperationGroup>
>;
type ReadOnlyCatalogExposesOnlyReadKeys = Expect<
  Equal<ReadOnlyKeys, 'catalog.list' | 'catalog.get'>
>;

void (null as unknown as ReadOnlyCatalogExposesOnlyReadKeys);

// @ts-expect-error The full Catalog group requires explicit state and clock dependencies.
createCatalogOperationGroup(catalog);
