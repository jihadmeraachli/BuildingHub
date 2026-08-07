// ============================================================
// The last line of defence.
//
// Until now the app had NO error boundary: any render error unmounted
// everything and left an empty #root, so a crash looked like a blank teal
// screen with nothing to read and nothing to do. That is also what the
// chunk-load self-heal in main.tsx falls back to on its third strike (a stale
// deploy that reloads never fix), which is the most likely way a user meets
// it.
//
// This does not fix crashes. It makes them legible and recoverable: say what
// happened, offer the one action that usually works, and — for the stale-build
// case specifically — offer to clear the caches that are causing it.
// ============================================================
import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Kept in the console so a screenshot of DevTools still tells us where.
    console.error('app crashed:', error, info.componentStack);
  }

  /** The stale-deploy case: unregister service workers, drop every cache, and
   *  come back on the current build. Same steps as main.tsx's self-heal, but
   *  triggered deliberately instead of on a loop. */
  private async reset() {
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = (await caches?.keys?.()) ?? [];
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch { /* best effort — reloading is still worth a try */ }
    window.location.reload();
  }

  render() {
    if (!this.state.error) return this.props.children;

    // Deliberately not translated: i18n itself may be what failed, and a
    // fallback that throws is worse than plain English.
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
        <div className="max-w-md w-full text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Abniyah hit an unexpected error and could not finish loading. Your data is safe.
          </p>
          <div className="flex flex-wrap gap-2 justify-center mt-5">
            <button
              onClick={() => window.location.reload()}
              className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm font-medium cursor-pointer"
            >
              Reload
            </button>
            <button
              onClick={() => void this.reset()}
              className="rounded-xl border border-border px-4 py-2 text-sm cursor-pointer"
            >
              Clear cache and reload
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-5">
            If it keeps happening, send this to support@abniyah.com:
          </p>
          <pre className="mt-2 text-start text-[11px] bg-muted/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
            {this.state.error.message}
          </pre>
        </div>
      </div>
    );
  }
}
