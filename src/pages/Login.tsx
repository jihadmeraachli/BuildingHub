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
import { Globe } from 'lucide-react';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

type FormData = z.infer<typeof schema>;

export default function Login() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(data: FormData) {
    setError('');
    const { error } = await supabase.auth.signInWithPassword(data);
    if (error) setError(t('auth.invalidCredentials'));
    else navigate('/dashboard');
  }

  return (
    <div className="min-h-screen flex">
      {/* Left: brand panel */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 overflow-hidden">
        <div className="absolute -top-24 -end-24 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-0 -start-24 w-96 h-96 rounded-full bg-violet-400/20 blur-3xl" />
        <div className="relative z-10 flex flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center font-extrabold">BH</div>
            <span className="text-lg font-bold">BuildingHub</span>
          </div>
          <div>
            <h1 className="text-4xl font-bold leading-tight mb-3">Run your building<br />like a pro.</h1>
            <p className="text-lg text-white/80 max-w-md">Expenses, collections, and the building book — all in one place. Built for Lebanon's buildings & compounds.</p>
          </div>
          <p className="text-sm text-white/50">© BuildingHub</p>
        </div>
      </div>

      {/* Right: form */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 py-12 bg-white">
        <div className="w-full max-w-sm">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2.5 lg:hidden">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white font-extrabold text-sm">BH</div>
              <span className="text-lg font-bold text-slate-900">BuildingHub</span>
            </div>
            <button
              onClick={() => setLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
              className="ms-auto flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              <Globe size={14} />
              {i18n.language === 'ar' ? 'EN' : 'عر'}
            </button>
          </div>

          <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
          <p className="text-slate-500 text-sm mt-1 mb-6">{t('auth.login')} to continue</p>

          {error && (
            <div className="mb-4 rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input label={t('auth.email')} type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
            <Input label={t('auth.password')} type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
            <Button type="submit" loading={isSubmitting} className="w-full mt-2">{t('auth.login')}</Button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            {t('auth.noAccount')}{' '}
            <Link to="/register" className="text-indigo-600 font-semibold hover:underline">{t('auth.registerHere')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
