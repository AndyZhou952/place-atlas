export function requireTestBaseUrl(value = process.env.ATLAS_BASE_URL) {
  if (!value)
    throw new Error('Set ATLAS_BASE_URL to your authorized test deployment.');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error(
      'ATLAS_BASE_URL must be an HTTPS origin without credentials.',
    );
  return url.origin;
}
