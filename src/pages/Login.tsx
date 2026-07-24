import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { setLanguage } from '@/i18n';
import { Globe, ArrowLeft, Mail, Smartphone } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

type LoginData = z.infer<typeof loginSchema>;
type Mode = 'login' | 'forgot' | 'forgot-sent' | 'mfa';

export default function Login() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { mfaPending } = useAuth();
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
  });

  // A password-only session on a 2FA account gets bounced here by ProtectedRoute —
  // jump straight to the code screen.
  useEffect(() => {
    if (mfaPending) setMode('mfa');
  }, [mfaPending]);

  // After a successful code entry, mfaPending flips false a beat later than the
  // navigate — if that beat bounced us back here, finish the trip.
  const { user: authedUser } = useAuth();
  useEffect(() => {
    if (!mfaPending && mode === 'mfa' && authedUser) navigate('/dashboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mfaPending, authedUser]);

  async function onSubmit(data: LoginData) {
    setError('');
    const { data: signInData, error } = await supabase.auth.signInWithPassword(data);
    if (error) { setError(t('auth.invalidCredentials')); return; }
    // 2FA enrolled? Then the password only gets us to aal1 — ask for the code.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
      setMfaCode('');
      setMode('mfa');
      return;
    }
    // Confirmed email but never finished onboarding (e.g. closed the tab) —
    // send them to Register, which detects the stored answers and completes setup.
    if (signInData.user?.user_metadata?.pending_onboarding) {
      navigate('/register');
    } else {
      navigate('/dashboard');
    }
  }

  async function onMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mfaCode.length !== 6) return;
    setError('');
    setMfaLoading(true);
    const { data: factorData } = await supabase.auth.mfa.listFactors();
    const factor = factorData?.totp?.find(f => f.status === 'verified');
    if (!factor) {
      setMfaLoading(false);
      setError(t('auth.mfaInvalidCode'));
      return;
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: mfaCode });
    setMfaLoading(false);
    if (error) { setError(t('auth.mfaInvalidCode')); return; }
    const { data: userData } = await supabase.auth.getUser();
    navigate(userData.user?.user_metadata?.pending_onboarding ? '/register' : '/dashboard');
  }

  async function onResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!resetEmail.trim()) return;
    setResetLoading(true);
    await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: window.location.origin + '/set-password',
    });
    setResetLoading(false);
    setMode('forgot-sent');
  }

  const brandPanel = (
    <div
      className="hidden lg:flex lg:w-1/2 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, oklch(0.38 0.14 185) 0%, oklch(0.22 0.05 185) 100%)' }}
    >
      <div className="absolute -top-24 -end-24 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute bottom-0 -start-24 w-96 h-96 rounded-full bg-[oklch(0.55_0.18_185)]/20 blur-3xl" />
      <div className="relative z-10 flex flex-col justify-between p-12 text-white">
        <div className="flex items-center gap-2.5">
          <Logo size={40} variant="white" />
          <span className="text-lg font-bold">Abniyah</span>
        </div>
        <div>
          <h1
            className="text-4xl font-bold leading-tight mb-3"
            style={{
              background: 'linear-gradient(100deg, oklch(1 0 0) 0%, oklch(0.72 0.012 185) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >Run your building<br />like a pro.</h1>
          <p className="text-lg text-white/80 max-w-md">Expenses, collections, and the building book — all in one place. Built for Lebanon's buildings & compounds.</p>
        </div>
        <p className="text-sm text-white/50">© Abniyah</p>
      </div>
    </div>
  );

  const langToggle = (
    <button
      onClick={() => setLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
      className="ms-auto flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
    >
      <Globe size={14} />
      {i18n.language === 'ar' ? 'EN' : 'عر'}
    </button>
  );

  return (
    <div className="min-h-screen flex">
      {brandPanel}

      <div className="flex-1 flex flex-col justify-center items-center px-6 py-12 bg-background">
        <div className="w-full max-w-sm">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2.5 lg:hidden">
              <Logo size={36} />
              <span className="text-lg font-bold text-foreground">Abniyah</span>
            </div>
            {langToggle}
          </div>

          {mode === 'login' && (
            <>
              <h2 className="text-2xl font-bold text-foreground">Welcome back</h2>
              <p className="text-muted-foreground text-sm mt-1 mb-6">{t('auth.login')} to continue</p>

              {error && (
                <div className="mb-4 rounded-xl bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <Input label={t('auth.email')} type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
                <div>
                  <Input label={t('auth.password')} type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
                  <button
                    type="button"
                    onClick={() => { setError(''); setMode('forgot'); }}
                    className="mt-1.5 text-xs text-primary hover:underline cursor-pointer"
                  >
                    {t('auth.forgotPassword')}
                  </button>
                </div>
                <Button type="submit" loading={isSubmitting} className="w-full mt-2">{t('auth.login')}</Button>
              </form>

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {t('auth.noAccount')}{' '}
                <Link to="/register" className="text-primary font-semibold hover:underline">{t('auth.registerHere')}</Link>
              </p>
            </>
          )}

          {mode === 'forgot' && (
            <>
              <button
                onClick={() => setMode('login')}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 cursor-pointer"
              >
                <ArrowLeft size={14} /> {t('auth.backToLogin')}
              </button>

              <h2 className="text-2xl font-bold text-foreground">{t('auth.resetTitle')}</h2>
              <p className="text-muted-foreground text-sm mt-1 mb-6">{t('auth.resetSubtitle')}</p>

              <form onSubmit={onResetSubmit} className="space-y-4">
                <Input
                  label={t('auth.email')}
                  type="email"
                  autoComplete="email"
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value)}
                />
                <Button type="submit" loading={resetLoading} className="w-full" disabled={!resetEmail.trim()}>
                  {t('auth.sendResetLink')}
                </Button>
              </form>
            </>
          )}

          {mode === 'mfa' && (
            <>
              <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mb-4">
                <Smartphone size={26} className="text-primary" />
              </div>
              <h2 className="text-2xl font-bold text-foreground">{t('auth.mfaChallengeTitle')}</h2>
              <p className="text-muted-foreground text-sm mt-1 mb-6">{t('auth.mfaChallengeSubtitle')}</p>

              {error && (
                <div className="mb-4 rounded-xl bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <form onSubmit={onMfaSubmit} className="space-y-4">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center text-lg tracking-[0.4em] font-semibold"
                />
                <Button type="submit" loading={mfaLoading} className="w-full" disabled={mfaCode.length !== 6}>
                  {t('auth.mfaVerifyBtn')}
                </Button>
              </form>

              <button
                onClick={async () => { await supabase.auth.signOut(); setMode('login'); setError(''); }}
                className="mt-6 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
              >
                {t('auth.backToLogin')}
              </button>
            </>
          )}

          {mode === 'forgot-sent' && (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mx-auto mb-4">
                <Mail size={26} className="text-primary" />
              </div>
              <h2 className="text-xl font-bold text-foreground mb-2">{t('auth.resetSentTitle')}</h2>
              <p className="text-muted-foreground text-sm mb-6">{t('auth.resetSentBody', { email: resetEmail })}</p>
              <button
                onClick={() => { setMode('login'); setResetEmail(''); }}
                className="text-sm text-primary hover:underline cursor-pointer"
              >
                {t('auth.backToLogin')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
