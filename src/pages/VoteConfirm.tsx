import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, Vote } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';

/**
 * /vote — the one-click ballot from the notification email (0168).
 *
 * PUBLIC on purpose: the whole point is voting from the inbox without
 * logging in. Nothing here is trusted — the signed link is verified by the
 * `vote-click` edge function, which casts through cast_vote() so every
 * eligibility/window/weight rule still applies.
 *
 * Why a page in the app rather than HTML from the function: Supabase rewrites
 * edge-function responses on *.supabase.co to text/plain with a sandbox CSP
 * (anti-phishing), so a function there can never render a page.
 */
const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vote-click`;

type Phase = 'loading' | 'confirm' | 'saving' | 'done' | 'closed' | 'invalid' | 'error';

export default function VoteConfirm() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const qs = ['u', 'p', 'o', 's'].map((k) => `${k}=${encodeURIComponent(params.get(k) ?? '')}`).join('&');

  const [phase, setPhase] = useState<Phase>('loading');
  const [title, setTitle] = useState('');
  const [option, setOption] = useState('');
  const [errMsg, setErrMsg] = useState('');

  const call = useCallback(async (method: 'GET' | 'POST') => {
    // f=json: a bare GET on the function redirects humans to this page
    const res = await fetch(`${FN}?${qs}&f=json`, { method });
    // the gateway forces text/plain on function responses; parse it ourselves
    return JSON.parse(await res.text()) as {
      ok: boolean; reason?: string; error?: string; title?: string; option?: string; cast?: boolean;
    };
  }, [qs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await call('GET');
        if (cancelled) return;
        setTitle(r.title ?? ''); setOption(r.option ?? '');
        setPhase(r.ok ? 'confirm' : r.reason === 'closed' ? 'closed' : 'invalid');
      } catch {
        if (!cancelled) setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [call]);

  async function confirm() {
    setPhase('saving');
    try {
      const r = await call('POST');
      setTitle(r.title ?? title); setOption(r.option ?? option);
      if (r.ok) { setPhase('done'); return; }
      if (r.reason === 'closed') { setPhase('closed'); return; }
      setErrMsg(r.error ?? ''); setPhase('error');
    } catch {
      setPhase('error');
    }
  }

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-10">
      <div className="flex items-center gap-2 mb-6">
        <Logo className="h-8 w-8" />
        <Wordmark className="h-5" />
      </div>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-sm">
        {children}
      </div>
      <a href="/voting" className="mt-5 text-sm text-primary hover:underline">{t('voteLink.openApp')}</a>
    </div>
  );

  if (phase === 'loading') {
    return <Shell><p className="text-sm text-muted-foreground text-center py-4">{t('common.loading')}</p></Shell>;
  }

  if (phase === 'done') {
    return (
      <Shell>
        <div className="text-center">
          <CheckCircle2 className="mx-auto text-emerald-500 mb-3" size={34} />
          <h1 className="text-lg font-semibold text-foreground">{t('voteLink.done')}</h1>
          {option && <p className="text-sm text-foreground mt-2">{t('voteLink.yourChoice')}: <strong>{option}</strong></p>}
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{t('voteLink.doneBody')}</p>
        </div>
      </Shell>
    );
  }

  if (phase === 'closed' || phase === 'invalid' || phase === 'error') {
    const head = phase === 'closed' ? t('voteLink.closed') : phase === 'invalid' ? t('voteLink.invalid') : t('voteLink.error');
    const body = phase === 'closed' ? t('voteLink.closedBody') : phase === 'invalid' ? t('voteLink.invalidBody') : (errMsg || t('voteLink.errorBody'));
    return (
      <Shell>
        <div className="text-center">
          <AlertTriangle className="mx-auto text-amber-500 mb-3" size={32} />
          <h1 className="text-lg font-semibold text-foreground">{head}</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{body}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="text-center">
        <Vote className="mx-auto text-primary mb-3" size={30} />
        <h1 className="text-lg font-semibold text-foreground">{t('voteLink.confirmTitle')}</h1>
        <p className="text-sm text-muted-foreground mt-2">{t('voteLink.youAreVoting')}</p>
        <p className="text-sm font-medium text-foreground mt-0.5">{title}</p>
        <div className="mt-4 rounded-xl bg-secondary px-4 py-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('voteLink.yourChoice')}</p>
          <p className="text-base font-semibold text-foreground mt-0.5">{option}</p>
        </div>
        <Button className="w-full mt-5" onClick={confirm} loading={phase === 'saving'}>
          {t('voteLink.confirm')}
        </Button>
        <p className="text-xs text-muted-foreground mt-3">{t('voteLink.changeable')}</p>
      </div>
    </Shell>
  );
}
