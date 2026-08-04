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
import { Wordmark } from '@/components/ui/Wordmark';
import { setLanguage } from '@/i18n';
import { Globe, ArrowLeft, Mail, Smartphone } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

type LoginData = z.infer<typeof loginSchema>;
type Mode = 'login' | 'forgot' | 'forgot-sent' | 'mfa';

/** Last address signed in on this device. Convenience only — no password, and
 *  it survives sign-out deliberately, which is the whole point. */
const LAST_EMAIL_KEY = 'abniyah_last_email';

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

  // Pre-fill the address used last time on this device. Only the email — never
  // the password — so a returning user types one field instead of two.
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: localStorage.getItem(LAST_EMAIL_KEY) ?? '' },
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
    localStorage.setItem(LAST_EMAIL_KEY, data.email.trim());
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
      <div className="relative z-10 flex flex-col p-12 text-white">
        <div className="flex items-center gap-2.5">
          <Logo size={40} variant="white" />
          <Wordmark className="text-base" />
        </div>
        {/* my-auto centers the headline in the space below the logo */}
        <div className="my-auto">
          <h1
            className="text-4xl font-bold leading-tight mb-3"
            style={{
              background: 'linear-gradient(100deg, oklch(1 0 0) 0%, oklch(0.72 0.012 185) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >{t('auth.heroTitle1')}<br />{t('auth.heroTitle2')}</h1>
          <p className="text-lg text-white/80 max-w-md">{t('auth.heroTagline')}</p>
        </div>
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

      {/* Form side: quiet, deep gradient in dark mode so it reads as one
          composition with the brand panel — deliberately far subtler than the
          left, keeping the form as the focal point. Light mode stays clean. */}
      <div className="relative flex-1 flex flex-col justify-center items-center px-6 py-12 bg-background dark:bg-[linear-gradient(160deg,oklch(0.21_0.045_185)_0%,oklch(0.15_0.03_187)_55%,oklch(0.12_0.025_190)_100%)]">
        {/* Brand↔legal-entity link: also serves as verifiable evidence for
            reviewers (e.g. Meta's WhatsApp display-name check). */}
        <p className="absolute bottom-4 text-[11px] text-muted-foreground/60">
          Abniyah is a product of Tatawwor
        </p>
        <div className="w-full max-w-sm">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2.5 lg:hidden">
              <Logo size={36} />
              <Wordmark className="text-base text-foreground" />
            </div>
            {langToggle}
          </div>

          {mode === 'login' && (
            <>
              <h2 className="text-2xl font-bold text-foreground">{t('auth.welcomeBack')}</h2>
              <p className="text-muted-foreground text-sm mt-1 mb-6">{t('auth.signInToContinue')}</p>

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
