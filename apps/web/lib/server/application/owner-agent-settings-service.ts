import { getD1, getOwnerPocCatalogIntakeRuntime } from '@/db';
import {
  createAgentSettingsService,
  createD1AgentSettingsStore,
  verifyAgentConnection,
} from '../agent-settings.ts';

export function getOwnerAgentSettingsService() {
  const runtime = getOwnerPocCatalogIntakeRuntime();
  return createAgentSettingsService(
    createD1AgentSettingsStore(getD1()),
    runtime.agentSettingsSecret,
    runtime,
    verifyAgentConnection,
  );
}
