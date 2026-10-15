/** A standalone export embeds trusted preview assets as data URLs. The served
 * application leaves this map undefined and uses ordinary relative URLs. */
export function assetUrl(path: string): string {
  const assets = (globalThis as typeof globalThis & { __GALAXY_ASSETS__?: Record<string, string> }).__GALAXY_ASSETS__;
  return assets?.[path] ?? path;
}
