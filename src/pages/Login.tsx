import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { setLanguage } from '@/i18n';
import { Globe, ArrowLeft, Mail } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

type LoginData = z.infer<typeof loginSchema>;
type Mode = 'login' | 'forgot' | 'forgot-sent';

export default function Login() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(data: LoginData) {
    setError('');
    const { error } = await supabase.auth.signInWithPassword(data);
    if (error) setError(t('auth.invalidCredentials'));
    else navigate('/dashboard');
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
          <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center font-extrabold">BH</div>
          <span className="text-lg font-bold">BuildingHub</span>
        </div>
        <div>
          <h1 className="text-gradient text-4xl font-bold leading-tight mb-3">Run your building<br />like a pro.</h1>
          <p className="text-lg text-white/80 max-w-md">Expenses, collections, and the building book — all in one place. Built for Lebanon's buildings & compounds.</p>
        </div>
        <p className="text-sm text-white/50">© BuildingHub</p>
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
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-extrabold text-sm"
                style={{ background: 'linear-gradient(135deg, oklch(0.54 0.115 186) 0%, oklch(0.38 0.14 185) 100%)' }}
              >BH</div>
              <span className="text-lg font-bold text-foreground">BuildingHub</span>
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
