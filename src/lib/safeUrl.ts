/**
 * Return the value only if it is a plain http(s) URL, otherwise undefined.
 *
 * React does NOT sanitize `javascript:` / `data:` URLs placed in an <a href>,
 * so a user-supplied meeting or map link could run script in a viewer's
 * session. Run every user-controlled href through this before rendering.
 * (Security audit M4.)
 */
export function safeHttpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? v : undefined;
  } catch {
    return undefined;
  }
}
