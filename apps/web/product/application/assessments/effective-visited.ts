export function isEffectivelyVisited(
  manualVisited: boolean | undefined,
  visitCount: number,
): boolean {
  return Boolean(manualVisited) || visitCount > 0;
}
