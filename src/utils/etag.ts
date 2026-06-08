export function formatETag(version: unknown): string {
  return `"${version}"`;
}

export function parseIfMatch(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const stripped = header.replace(/^"/, '').replace(/"$/, '').replace(/^W\//, '');
  const val = Number(stripped);
  return Number.isNaN(val) ? undefined : val;
}
