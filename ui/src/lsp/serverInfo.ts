/**
 * A server's version as a reader wants it: `v0.18.1`. Most servers send exactly that; gopls sends its whole
 * build record as JSON, with the version inside it.
 */
export function versionOf(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const text = raw.trim();
  if (text.startsWith('{')) {
    try {
      const build = JSON.parse(text) as { Main?: { Version?: string }; Version?: string };
      return build.Main?.Version ?? build.Version;
    } catch {
      return undefined;
    }
  }
  const first = text.split(/\s+/)[0];
  return first.length > 24 ? undefined : first;
}
