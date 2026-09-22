import handler from 'vinext/server/fetch-handler';

import { runD1CatalogIntakeCleanup } from './lib/server/application/catalog-intake-maintenance';
import { createOwnerPocWorker } from './lib/server/application/owner-poc-worker';

export default createOwnerPocWorker(handler, runD1CatalogIntakeCleanup);
