const railMoves = new Set([
  'superexpress_train',
  'sleeper_ultraexpress',
  'ultraexpress_train',
  'express_train',
  'rapid_train',
  'semiexpress_train',
  'local_train',
]);

export interface NavitimeDirectRoute {
  readonly durationSeconds: number;
  readonly lineIdentity: string;
  readonly estimateBasis: 'average';
}

export function mapNavitimeTransitRouteResponse(
  raw: unknown,
): { readonly directRoute: NavitimeDirectRoute | null } | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.items) || raw.items.length > 10)
    return undefined;
  const routes = raw.items.map(parseRoute);
  if (routes.some((route) => route === undefined)) return undefined;
  const direct = routes
    .filter((route): route is NavitimeDirectRoute => route !== null)
    .sort((a, b) => a.durationSeconds - b.durationSeconds)[0];
  return { directRoute: direct ?? null };
}

function parseRoute(value: unknown): NavitimeDirectRoute | null | undefined {
  if (!isRecord(value) || !isRecord(value.summary)) return undefined;
  const summary = value.summary;
  if (
    !isRecord(summary.move) ||
    summary.move.type !== 'move' ||
    !Number.isInteger(summary.move.time) ||
    (summary.move.time as number) <= 0 ||
    !Number.isInteger(summary.move.transit_count) ||
    (summary.move.transit_count as number) < 0 ||
    !Array.isArray(value.sections) ||
    value.sections.length < 3 ||
    value.sections.length % 2 !== 1
  )
    return undefined;
  const moves = value.sections.filter(
    (section): section is Record<string, unknown> =>
      isRecord(section) && section.type === 'move',
  );
  if (
    value.sections.some(
      (section, index) =>
        !isRecord(section) || section.type !== (index % 2 ? 'move' : 'point'),
    ) ||
    moves.some(
      (move) =>
        typeof move.move !== 'string' ||
        !Number.isFinite(move.time) ||
        (move.time as number) < 0,
    ) ||
    moves.reduce((total, move) => total + (move.time as number), 0) >
      (summary.move.time as number)
  )
    return undefined;
  const rails = moves.filter((move) => railMoves.has(move.move as string));
  if (
    summary.move.transit_count !== 0 ||
    rails.length !== 1 ||
    moves.some(
      (move) => move.move !== 'walk' && !railMoves.has(move.move as string),
    )
  )
    return null;
  const transport = rails[0].transport;
  const preferredName = isRecord(transport) ? transport.self_name : undefined;
  const lineIdentity =
    typeof preferredName === 'string' && preferredName.trim()
      ? preferredName
      : rails[0].line_name;
  if (typeof lineIdentity !== 'string' || !lineIdentity.trim())
    return undefined;
  return {
    durationSeconds: (summary.move.time as number) * 60,
    lineIdentity: lineIdentity.trim(),
    estimateBasis: 'average',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
