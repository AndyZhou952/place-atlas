import type { AtlasApplication } from '../atlas-application.ts';
import type { NearbyRecommendApplicationDefinitions } from '../decision/agent-nearby-operation.ts';
import { failure, success, type Result } from '../result.ts';
import { presentNearbyWechatResult } from './nearby-wechat-presenter.ts';

export interface NearbyRecommendationInput {
  readonly locationHint: string;
}

export interface NearbyRecommendationItem {
  readonly itemId: string;
  readonly name: string;
  readonly area: string;
  readonly address: string;
  readonly walkingMinutes: number;
  readonly visited: boolean;
  readonly reason: string;
  readonly mapDeepLink: string;
}

export interface NearbyRecommendationResult {
  readonly requestedLocation: string;
  readonly resolvedLocation: string;
  readonly recommendations: readonly NearbyRecommendationItem[];
}

export interface NearbyRecommendationProvider {
  recommend(
    input: NearbyRecommendationInput,
  ): Promise<Result<NearbyRecommendationResult>>;
}

export type NearbyApplicationDefinitions =
  NearbyRecommendApplicationDefinitions;

export function createProjectCommandRouter(
  application: AtlasApplication<NearbyApplicationDefinitions>,
) {
  return {
    async dispatch(command: string): Promise<ProjectCommandResult> {
      const parsed = parseNearbyCommand(command);
      if (!parsed.ok) return parsed;

      const result = await application.execute({
        key: 'nearby.recommend',
        input: { locationHint: parsed.value.locationHint },
      });
      if (!result.ok) {
        return failure(
          result.error.kind === 'dependency_failure'
            ? 'dependency_failure'
            : result.error.kind,
          result.error.kind === 'dependency_failure'
            ? 'Japan Atlas 附近查询暂时不可用，请稍后重试。'
            : 'Japan Atlas 请求未能完成。',
        );
      }

      return success({
        projectId: 'jpmap',
        operation: 'nearby',
        replyText: presentNearbyWechatResult(result.value),
      });
    },
  };
}

export function createAgentToolCatalog() {
  return {
    manifest(projectId: 'jpmap', phase: 'read') {
      return {
        service: 'Japan Atlas',
        version: '2026-09-13',
        projectId,
        phase,
        tools: [
          {
            name: 'jpmap_nearby',
            operation: 'nearby.recommend',
            effect: 'read',
            requiredScope: 'atlas:nearby:read',
            confirmation: 'none',
            retry: 'safe',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              required: ['locationHint'],
              properties: {
                locationHint: { type: 'string', minLength: 1 },
              },
            },
          },
        ],
      } as const;
    },
  };
}

interface ProjectCommandReply {
  readonly projectId: 'jpmap';
  readonly operation: 'nearby';
  readonly replyText: string;
}

type ProjectCommandResult = Result<ProjectCommandReply>;

function parseNearbyCommand(
  command: string,
): Result<{ readonly locationHint: string }> {
  const match = /^\/jpmap nearby\s+(.+\S|\S)\s*$/u.exec(command);
  if (!match) return invalidCommand();
  const locationHint = match[1]?.trim();
  return locationHint ? success({ locationHint }) : invalidCommand();
}

function invalidCommand(): Result<never> {
  return failure('invalid_input', '用法：/jpmap nearby <街区或地址>');
}
