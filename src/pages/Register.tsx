import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/Input';
import { SelectField, SelectItem } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';

const schema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  apartment_number: z.string().min(1),
  phone: z.string().optional(),
  building_id: z.string().uuid('Please select a building'),
});

type FormData = z.infer<typeof schema>;

interface Building { id: string; name: string; city: string; }

export default function Register() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loadingBuildings, setLoadingBuildings] = useState(false);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState('');

  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  async function loadBuildings() {
    if (buildings.length > 0) return;
    setLoadingBuildings(true);
    const { data } = await supabase.from('buildings').select('id, name, city').eq('is_active', true).order('name');
    setBuildings(data ?? []);
    setLoadingBuildings(false);
  }

  async function onSubmit(data: FormData) {
    setServerError('');
    const { error: signUpError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          full_name: data.full_name,
          apartment_number: data.apartment_number,
          phone: data.phone ?? '',
          building_id: data.building_id,
        },
      },
    });
    if (signUpError) {
      setServerError(signUpError.message);
    } else {
      setSuccess(true);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-sm text-center">
          <div className="w-16 h-16 bg-primary/15 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl text-primary">✓</div>
          <h2 className="text-xl font-bold text-foreground mb-2">{t('auth.registrationSuccess').split('.')[0]}</h2>
          <p className="text-muted-foreground text-sm mb-6">{t('auth.registrationSuccess')}</p>
          <Button onClick={() => navigate('/')} variant="secondary">{t('auth.loginHere')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-background">
      <div className="w-full max-w-md bg-card rounded-2xl shadow-sm border border-border p-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-foreground">Abniyah</h2>
          <p className="text-muted-foreground text-sm mt-1">{t('auth.register')}</p>
        </div>

        {serverError && (
          <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input label={t('auth.fullName')} error={errors.full_name?.message} {...register('full_name')} />
          <Input label={t('auth.email')} type="email" error={errors.email?.message} {...register('email')} />
          <Input label={t('auth.password')} type="password" error={errors.password?.message} {...register('password')} />
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('auth.apartmentNumber')} error={errors.apartment_number?.message} {...register('apartment_number')} />
            <Input label={t('auth.phone')} type="tel" error={errors.phone?.message} {...register('phone')} />
          </div>
          <Controller name="building_id" control={control} render={({ field }) => (
            <SelectField
              label={t('auth.building')}
              error={errors.building_id?.message}
              value={field.value || '__none__'}
              onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}
              onOpenChange={(open) => { if (open) loadBuildings(); }}
            >
              <SelectItem value="__none__">{loadingBuildings ? t('common.loading') : `-- ${t('auth.building')} --`}</SelectItem>
              {buildings.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.name} — {b.city}</SelectItem>
              ))}
            </SelectField>
          )} />
          <Button type="submit" loading={isSubmitting} className="w-full mt-2">
            {t('auth.register')}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('auth.hasAccount')}{' '}
          <Link to="/" className="text-primary font-semibold hover:underline">{t('auth.loginHere')}</Link>
        </p>
      </div>
    </div>
  );
}
