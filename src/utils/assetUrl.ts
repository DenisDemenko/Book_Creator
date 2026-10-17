/** Internal media addresses are stored without the public deployment prefix.
 * Resolve explicitly for HTML strings and CSS too: native innerHTML bypasses
 * the legacy src property interceptor. External/data/blob URLs stay unchanged.
 */
const INTERNAL = /^\/(?:api\/|generated\/)/;
const RELATIVE_INTERNAL = /^(?:api\/|generated\/)/;
const browserBase = () => import.meta.env?.BASE_URL || '/';

/** Convert legacy relative app-media paths to the canonical root-relative form. */
function canonicalInternalAssetPath(url: string): string {
  return RELATIVE_INTERNAL.test(url) ? '/' + url : url;
}

export function internalAssetPath(url: string, base = '/studio/'): string {
  const prefix = base.replace(/\/+$/, '');
  const normalized = canonicalInternalAssetPath(url);
  return prefix && normalized.startsWith(prefix + '/') && INTERNAL.test(normalized.slice(prefix.length))
    ? normalized.slice(prefix.length) : normalized;
}

export function assetUrl(url: string | undefined | null, base = browserBase()): string {
  const raw = String(url || '');
  const prefix = base.replace(/\/+$/, '');
  const canonical = internalAssetPath(raw, base);
  return prefix && INTERNAL.test(canonical) ? prefix + canonical : canonical;
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

/**
 * Rewrite src= only inside <img> tags. Rich-text/imported HTML can contain
 * already-rendered images rather than Nova's [IMG:...] markers; assigning
 * that HTML through innerHTML bypasses the old DOM src interceptor, so a
 * stored `api/...`, `/api/...`, `generated/...` or `/generated/...` path
 * must be resolved explicitly before pagination/preview.
 *
 * External http(s), data: and blob: URLs remain unchanged because assetUrl
 * deliberately leaves them alone. Quotes and the rest of the tag are kept.
 */
export function normalizeHtmlImageSources(html: string, base = browserBase()): string {
  if (!html || !/<img\b/i.test(html)) return html;
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    tag.replace(
      /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
      (full, doubleQuoted: string | undefined, singleQuoted: string | undefined, bare: string | undefined) => {
        const raw = doubleQuoted ?? singleQuoted ?? bare ?? '';
        const resolved = assetUrl(raw, base);
        if (doubleQuoted !== undefined) return `src="${resolved}"`;
        if (singleQuoted !== undefined) return `src='${resolved}'`;
        return `src=${resolved}`;
      },
    )
  );
}
