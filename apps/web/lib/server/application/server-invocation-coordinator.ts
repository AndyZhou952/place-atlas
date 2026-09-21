import { getD1 } from '@/db';
import { createInvocationCoordinator } from '@/product/application/invocation/invocation-coordinator';

import { D1MutationReceiptState } from './d1-mutation-receipt-state';
import {
  createServerAtlasApplication,
  getServerAtlasApplication,
} from './server-atlas-application';

export function createServerInvocationCoordinator(
  database: D1Database,
  mediaBucket: R2Bucket,
) {
  return createInvocationCoordinator({
    application: createServerAtlasApplication(database, mediaBucket),
    receipts: new D1MutationReceiptState(database),
  });
}

export function getServerInvocationCoordinator() {
  const database = getD1();
  return createInvocationCoordinator({
    application: getServerAtlasApplication(),
    receipts: new D1MutationReceiptState(database),
  });
}
