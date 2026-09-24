import type {
  ApplicationExecutionContext,
  AtlasApplication,
} from '../atlas-application.ts';
import type {
  CatalogIntakeCancelOutput,
  CatalogIntakeConfirmOutput,
  CatalogIntakeDiscoverOutput,
  CatalogIntakeSelectOutput,
  createCatalogIntakeOperationGroup,
} from '../catalog-intake/catalog-intake-coordinator.ts';
import { presentCatalogIntakePreviewText } from '../catalog-intake/catalog-intake-preview-presenter.ts';
import type {
  NearbyRecommendApplicationDefinitions,
  NearbyRecommendResult,
} from '../decision/agent-nearby-operation.ts';
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

export type CatalogIntakeApplicationDefinitions = ReturnType<
  typeof createCatalogIntakeOperationGroup
>;

export type CatalogIntakeConversationReference =
  | {
      readonly state: 'candidates_ready';
      readonly sessionId: string;
      readonly sessionVersion: number;
    }
  | {
      readonly state: 'preview_ready';
      readonly sessionId: string;
      readonly sessionVersion: number;
      readonly previewVersion: number;
    }
  | {
      readonly state: 'committed';
      readonly sessionId: string;
      readonly sessionVersion: number;
      readonly previewVersion: number;
    };

export interface CatalogIntakeConversationResolver {
  resolve(
    invocation: NonNullable<ApplicationExecutionContext['invocation']>,
  ): Promise<CatalogIntakeConversationReference | undefined>;
}

export interface ProjectCommandDispatchContext {
  readonly requestToken: string;
  readonly invocation: NonNullable<ApplicationExecutionContext['invocation']>;
}

interface ProjectCommandRouterOptions {
  readonly catalogIntakeApplication: AtlasApplication<CatalogIntakeApplicationDefinitions>;
  readonly conversationResolver: CatalogIntakeConversationResolver;
}

export function createProjectCommandRouter(
  application: AtlasApplication<NearbyApplicationDefinitions>,
  options?: ProjectCommandRouterOptions,
) {
  return {
    async dispatch(
      command: string,
      context?: ProjectCommandDispatchContext,
    ): Promise<ProjectCommandResult> {
      const parsed = parseProjectCommand(command);
      if (!parsed.ok) return parsed;

      if (parsed.value.kind !== 'nearby') {
        if (!options || !context) {
          return failure(
            'dependency_failure',
            'Japan Atlas 添加功能暂时不可用。',
          );
        }
        return dispatchCatalogIntakeCommand(parsed.value, context, options);
      }

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
        nearby: result.value,
        replyText: presentNearbyWechatResult(result.value),
      });
    },
  };
}

export function createAgentToolCatalog() {
  return {
    manifest(projectId: 'jpmap', phase: 'read' | 'owner') {
      const nearby = {
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
      } as const;
      return {
        service: 'Japan Atlas',
        version: '2026-09-13',
        projectId,
        phase,
        tools:
          phase === 'read' ? [nearby] : [nearby, ...catalogIntakeAgentTools],
      } as const;
    },
  };
}

const catalogIntakeAgentTools = [
  {
    name: 'jpmap_add_discover',
    operation: 'catalog.intake.discover',
    effect: 'write',
    requiredScope: 'atlas:intake:write',
    confirmation: 'none',
    retry: 'safe',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: { query: { type: 'string', minLength: 1 } },
    },
  },
  {
    name: 'jpmap_add_select',
    operation: 'catalog.intake.select',
    effect: 'write',
    requiredScope: 'atlas:intake:write',
    confirmation: 'none',
    retry: 'safe',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ordinal'],
      properties: { ordinal: { type: 'integer', minimum: 1, maximum: 3 } },
    },
  },
  {
    name: 'jpmap_add_confirm',
    operation: 'catalog.intake.confirm',
    effect: 'write',
    requiredScope: 'atlas:intake:write',
    confirmation: 'explicit_command',
    retry: 'safe',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'jpmap_add_cancel',
    operation: 'catalog.intake.cancel',
    effect: 'write',
    requiredScope: 'atlas:intake:write',
    confirmation: 'explicit_command',
    retry: 'safe',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
] as const;

export interface ProjectCommandReply {
  readonly projectId: 'jpmap';
  readonly replyText: string;
  readonly operation: 'nearby' | 'add';
  readonly nearby?: NearbyRecommendResult;
  readonly step?:
    | 'candidates'
    | 'clarification'
    | 'preview'
    | 'committed'
    | 'failed_no_write'
    | 'cancelled';
  readonly intake?:
    | CatalogIntakeDiscoverOutput
    | CatalogIntakeSelectOutput
    | CatalogIntakeConfirmOutput
    | CatalogIntakeCancelOutput;
}

export type ProjectCommandResult = Result<ProjectCommandReply>;

type ParsedProjectCommand =
  | { readonly kind: 'nearby'; readonly locationHint: string }
  | { readonly kind: 'add_discover'; readonly query: string }
  | { readonly kind: 'add_select'; readonly ordinal: number }
  | { readonly kind: 'add_confirm' }
  | { readonly kind: 'add_cancel' };

function parseProjectCommand(command: string): Result<ParsedProjectCommand> {
  const nearby = /^\/jpmap nearby\s+(.+\S|\S)\s*$/u.exec(command);
  const locationHint = nearby?.[1]?.trim();
  if (locationHint) return success({ kind: 'nearby', locationHint });

  const select = /^\/jpmap add select\s+([1-3])\s*$/u.exec(command);
  if (select?.[1]) {
    return success({ kind: 'add_select', ordinal: Number(select[1]) });
  }
  if (/^\/jpmap add confirm\s*$/u.test(command)) {
    return success({ kind: 'add_confirm' });
  }
  if (/^\/jpmap add cancel\s*$/u.test(command)) {
    return success({ kind: 'add_cancel' });
  }
  const discover = /^\/jpmap add\s+(.+\S|\S)\s*$/u.exec(command);
  const query = discover?.[1]?.normalize('NFC').trim();
  if (query && !/^(?:select|confirm|cancel)(?:\s|$)/u.test(query)) {
    return success({ kind: 'add_discover', query });
  }
  return invalidCommand();
}

function invalidCommand(): Result<never> {
  return failure(
    'invalid_input',
    '用法：\n/jpmap nearby <街区或地址>\n/jpmap add <餐厅名或地址>\n/jpmap add select <1-3>\n/jpmap add confirm\n/jpmap add cancel',
  );
}

async function dispatchCatalogIntakeCommand(
  command: Exclude<ParsedProjectCommand, { readonly kind: 'nearby' }>,
  context: ProjectCommandDispatchContext,
  options: ProjectCommandRouterOptions,
): Promise<ProjectCommandResult> {
  const executionContext = { invocation: context.invocation };
  if (command.kind === 'add_discover') {
    const result = await options.catalogIntakeApplication.execute(
      {
        key: 'catalog.intake.discover',
        input: { query: command.query, requestToken: context.requestToken },
      },
      executionContext,
    );
    if (!result.ok) return catalogIntakeFailure(result.error.kind);
    return success({
      projectId: 'jpmap',
      operation: 'add',
      step: 'candidates',
      intake: result.value,
      replyText: presentDiscover(result.value),
    });
  }

  const current = await options.conversationResolver.resolve(
    context.invocation,
  );
  if (!current) {
    return failure(
      'not_found',
      '当前对话没有可继续的 Add。请先发送 /jpmap add <餐厅名>。',
    );
  }

  if (command.kind === 'add_select') {
    if (current.state !== 'candidates_ready') return intakeStateConflict();
    const result = await options.catalogIntakeApplication.execute(
      {
        key: 'catalog.intake.select',
        input: {
          sessionId: current.sessionId,
          expectedSessionVersion: current.sessionVersion,
          ordinal: command.ordinal,
          requestResearch: true,
        },
      },
      executionContext,
    );
    if (!result.ok) return catalogIntakeFailure(result.error.kind);
    const step =
      result.value.status === 'preview_ready' ? 'preview' : 'clarification';
    return success({
      projectId: 'jpmap',
      operation: 'add',
      step,
      intake: result.value,
      replyText: presentSelect(result.value),
    });
  }

  if (command.kind === 'add_confirm') {
    if (current.state !== 'preview_ready' && current.state !== 'committed') {
      return intakeStateConflict();
    }
    const result = await options.catalogIntakeApplication.execute(
      {
        key: 'catalog.intake.confirm',
        input: {
          sessionId: current.sessionId,
          expectedPreviewVersion: current.previewVersion,
        },
      },
      executionContext,
    );
    if (!result.ok) return catalogIntakeFailure(result.error.kind);
    const step =
      result.value.status === 'conflict'
        ? 'preview'
        : result.value.status === 'failed_no_write'
          ? 'failed_no_write'
          : 'committed';
    return success({
      projectId: 'jpmap',
      operation: 'add',
      step,
      intake: result.value,
      replyText: presentConfirm(result.value),
    });
  }

  if (current.state === 'committed') return intakeStateConflict();
  const result = await options.catalogIntakeApplication.execute(
    {
      key: 'catalog.intake.cancel',
      input: {
        sessionId: current.sessionId,
        expectedSessionVersion: current.sessionVersion,
      },
    },
    executionContext,
  );
  if (!result.ok) return catalogIntakeFailure(result.error.kind);
  return success({
    projectId: 'jpmap',
    operation: 'add',
    step: 'cancelled',
    intake: result.value,
    replyText: 'Japan Atlas｜本次 Add 已取消。',
  });
}

function catalogIntakeFailure(kind: string): ProjectCommandResult {
  return failure(
    kind === 'dependency_failure' ? 'dependency_failure' : mapFailureKind(kind),
    kind === 'dependency_failure'
      ? 'Japan Atlas 添加功能暂时不可用，请稍后重试。'
      : 'Japan Atlas Add 请求未能完成。',
  );
}

function mapFailureKind(
  kind: string,
): 'invalid_input' | 'not_found' | 'conflict' | 'unexpected_failure' {
  if (kind === 'invalid_input' || kind === 'not_found' || kind === 'conflict') {
    return kind;
  }
  return 'unexpected_failure';
}

function intakeStateConflict(): ProjectCommandResult {
  return failure(
    'conflict',
    'Add 阶段已经变化，请按当前回复中的下一步指令操作。',
  );
}

function presentDiscover(output: CatalogIntakeDiscoverOutput): string {
  if (!output.candidates.length) {
    return 'Japan Atlas｜没有找到明确候选。请补充街区或完整地址后重新 Add。';
  }
  const candidates = output.candidates.map(
    (candidate) =>
      `${candidate.ordinal}. ${candidate.transientName}\n${candidate.transientAddress}\n来源：${candidate.attribution.label}`,
  );
  return `Japan Atlas｜请选择餐厅\n${candidates.join('\n')}\n回复：/jpmap add select <编号>`;
}

function presentSelect(output: CatalogIntakeSelectOutput): string {
  if (output.status === 'clarification_required') {
    return `Japan Atlas｜需要补充信息\n${output.clarification.prompt}`;
  }
  return `Japan Atlas｜保存前预览\n${presentCatalogIntakePreviewText(output.preview)}\n回复：/jpmap add confirm 或 /jpmap add cancel`;
}

function presentConfirm(output: CatalogIntakeConfirmOutput): string {
  if (output.status === 'conflict') {
    return `Japan Atlas｜资料在确认时发生变化，本次没有写入。\n${presentCatalogIntakePreviewText(output.newPreview)}\n请完整检查刷新后的事实；仅在同意此版本后再次发送 /jpmap add confirm，或发送 /jpmap add cancel。`;
  }
  if (output.status === 'failed_no_write') {
    return 'Japan Atlas｜本次没有写入，请检查预览后重试。';
  }
  const label =
    output.status === 'committed_needs_review'
      ? '已保存到 Owner 待审核目录'
      : output.status === 'reused_existing'
        ? '已关联现有地点'
        : '已保存并加入地图目录';
  return `Japan Atlas｜${label}\n回执：${output.receiptRef}`;
}
