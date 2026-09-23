export function isSupportedNodeVersion(version) {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  const [major, minor, patch] = parsed;
  return (
    (major === 22 && atLeast(minor, patch, 22, 3)) ||
    (major === 24 && atLeast(minor, patch, 15, 0)) ||
    (major === 25 && atLeast(minor, patch, 9, 0)) ||
    major > 25
  );
}

export function isSupportedOpenClawVersion(output) {
  return /^(?:openclaw[ \t]+)?2026\.7\.1(?:[ \t]+\([0-9a-f]{7,40}\))?(?:[ \t]+—[ \t]+[^\r\n]+)?$/iu.test(
    output.trim(),
  );
}

export function createHostPreflightReport(input) {
  const checks = {
    node: isSupportedNodeVersion(input.nodeVersion),
    openclaw: isSupportedOpenClawVersion(input.openClawVersion),
    sqlite: input.sqliteAvailable === true,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    versions: {
      node: input.nodeVersion,
      openclaw: input.openClawVersion || "unavailable",
    },
    checks,
  };
}

function parseVersion(value) {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function atLeast(minor, patch, minimumMinor, minimumPatch) {
  return minor > minimumMinor || (minor === minimumMinor && patch >= minimumPatch);
}
