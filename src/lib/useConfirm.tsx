import { useCallback, useRef, useState } from 'react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

interface ConfirmOpts {
  confirmLabel?: string;
  /** Defaults to true — most confirm() replacements guard a delete/undo/overwrite. */
  destructive?: boolean;
}

/**
 * The async, Promise-returning sibling of window.confirm() — for a call site
 * whose surrounding function is too large/stateful to cleanly split into
 * "before the confirm" and "after the confirm" pieces (the two-state-plus-
 * ConfirmModal pattern used elsewhere in the app). Same contract as
 * window.confirm() (resolves to a boolean), so the call site barely changes:
 *   - if (!confirm(msg)) return;
 *   + if (!(await confirmAsync(title, msg))) return;
 * Render `ConfirmDialog` once, anywhere in the component's JSX.
 */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; message: string } & ConfirmOpts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirmAsync = useCallback((title: string, message: string, opts?: ConfirmOpts) => {
    setState({ title, message, ...opts });
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  function settle(result: boolean) {
    setState(null);
    resolver.current?.(result);
    resolver.current = null;
  }

  const ConfirmDialog = state ? (
    <ConfirmModal
      open onClose={() => settle(false)} onConfirm={() => settle(true)}
      title={state.title} message={state.message}
      confirmLabel={state.confirmLabel} destructive={state.destructive ?? true}
    />
  ) : null;

  return { confirmAsync, ConfirmDialog };
}
