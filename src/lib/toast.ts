import { toast as sonnerToast } from 'sonner';

/**
 * Thin wrapper around sonner's toast — every file imports `toast` from here
 * instead of 'sonner' directly, so a rule like this applies everywhere at
 * once instead of needing 150+ call sites individually updated.
 *
 * The read-only demo's write-guard (0094_demo_read_only.sql) raises the same
 * Postgres exception for every blocked write, and the client just toasts
 * whatever error.message it gets — so this one message was landing as a red
 * .error() next to genuine failures, even though nothing actually went
 * wrong. The trigger's text is hardcoded English at the DB layer (Postgres
 * exceptions aren't translated), so a plain substring match is reliable
 * regardless of the viewer's own language.
 */
const READ_ONLY_DEMO = 'This is a read-only demo.';

function errorOrInfo(message: Parameters<typeof sonnerToast.error>[0], ...rest: Parameters<typeof sonnerToast.error> extends [unknown, ...infer R] ? R : never) {
  if (typeof message === 'string' && message.includes(READ_ONLY_DEMO)) {
    return sonnerToast.info(message, ...(rest as Parameters<typeof sonnerToast.info> extends [unknown, ...infer R2] ? R2 : never));
  }
  return sonnerToast.error(message, ...rest);
}

// Object.assign onto the base callable (not a spread into a plain object) —
// sonner's `toast` is itself a function with .success/.error/... attached,
// and a spread would silently drop the bare toast(...) form.
export const toast = Object.assign(
  ((...args: Parameters<typeof sonnerToast>) => sonnerToast(...args)) as typeof sonnerToast,
  sonnerToast,
  { error: errorOrInfo },
);
