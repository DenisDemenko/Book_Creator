/** Internal media addresses are stored without the public deployment prefix.
 * Resolve explicitly for HTML strings and CSS too: native innerHTML bypasses
 * the legacy src property interceptor. External/data/blob URLs stay unchanged.
 */
const INTERNAL = /^\/(?:api\/|generated\/)/;
const browserBase = () => import.meta.env?.BASE_URL || '/';

export function internalAssetPath(url: string, base = '/studio/'): string {
  const prefix = base.replace(/\/+$/, '');
  return prefix && url.startsWith(prefix + '/') && INTERNAL.test(url.slice(prefix.length))
    ? url.slice(prefix.length) : url;
}

export function assetUrl(url: string | undefined | null, base = browserBase()): string {
  const raw = String(url || '');
  const prefix = base.replace(/\/+$/, '');
  const canonical = internalAssetPath(raw, base);
  return prefix && INTERNAL.test(canonical) ? prefix + canonical : raw;
}

export function htmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');
}

/** CSS quoted URL inside an HTML style attribute; keep CSS and HTML escaping separate. */
export function assetCssUrl(url: string): string {
  return 'url("' + url.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/[\n\r\f]/g, '') + '")';
}
