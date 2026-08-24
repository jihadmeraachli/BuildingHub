import { useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';
import { Button } from '@/components/ui/Button';
import { WaitlistForm } from '@/components/WaitlistForm';
import { Lock } from 'lucide-react';

/**
 * Private-beta gate. Active only when the build has VITE_BETA_GATE=1 —
 * production launch just removes that env var and redeploys, no code change.
 *
 * The code is verified by verify_beta_code() in the database (0036); it never
 * ships in the bundle. Once verified, the browser remembers via localStorage.
 */
const GATE_ON = import.meta.env.VITE_BETA_GATE === '1';
const STORAGE_KEY = 'abniyah_beta_ok';
// 0126: what the entered code unlocked — 'full' (testers) or 'demo' (site +
// demo only; Register refuses). Read app-wide via betaScope() in lib/demo.ts.
const SCOPE_KEY = 'abniyah_beta_scope';

export function BetaGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(
    () => !GATE_ON || localStorage.getItem(STORAGE_KEY) === '1',
  );
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setChecking(true);
    setError(false);
    // 0126: the scope-aware check. Returns 'full' | 'demo' | null.
    const { data, error: rpcError } = await supabase.rpc('beta_code_scope', { p_code: code });
    setChecking(false);
    if (rpcError || (data !== 'full' && data !== 'demo')) {
      setError(true);
      return;
    }
    localStorage.setItem(STORAGE_KEY, '1');
    localStorage.setItem(SCOPE_KEY, data);
    setUnlocked(true);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'linear-gradient(135deg, oklch(0.38 0.14 185) 0%, oklch(0.22 0.05 185) 100%)' }}
    >
      <div className="w-full max-w-sm bg-card rounded-2xl shadow-2xl border border-border p-8 text-center">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <Logo size={32} />
          <Wordmark className="text-sm text-foreground" />
        </div>

        <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-4">
          <Lock size={26} className="text-primary" />
        </div>

        <h1 className="text-xl font-bold text-foreground mb-2">Private beta</h1>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          Abniyah is currently in closed testing. Enter your access code to continue.
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            autoFocus
            value={code}
            onChange={e => { setCode(e.target.value); setError(false); }}
            placeholder="Access code"
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-center font-semibold tracking-wide text-foreground placeholder:font-normal placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {error && (
            <p className="text-sm text-destructive">That code isn't valid. Check with the Abniyah team.</p>
          )}
          <Button type="submit" loading={checking} disabled={!code.trim()} className="w-full">
            Enter
          </Button>
        </form>

        {/* Until now this screen offered a code or nothing, so everyone who
            arrived from a post without one simply left. The copy stays English
            like the rest of the gate; the standalone /waitlist page is
            translated and carries a language picker. */}
        <div className="mt-6 pt-5 border-t border-border">
          <p className="text-xs text-muted-foreground mb-2.5">
            No code yet? Leave your email and we'll tell you when Abniyah opens.
          </p>
          <WaitlistForm source="gate" />
        </div>

        {/* Brand↔legal-entity link. The gate is the ONLY page unauthenticated
            visitors (incl. Meta's display-name reviewers) can see — the same
            line on the login page sits behind this gate. */}
        <p className="mt-6 text-[11px] text-muted-foreground/60">
          Abniyah is a product of Tatawwor
        </p>
      </div>
    </div>
  );
}
