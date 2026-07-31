import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { Logo } from '@/components/ui/Logo';
import { Wordmark } from '@/components/ui/Wordmark';
import { KeyRound, LogOut, Loader2 } from 'lucide-react';

/**
 * Shown to residents whose unit has no active license (subscription expired,
 * trial ended, or the admin never assigned a license to their unit).
 * Enforcement itself is in the database — this is just the friendly wall.
 */
export default function NoLicense() {
  const { t } = useTranslation();
  const { signOut, profile, memberships } = useAuth();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const noUnit = memberships.length === 0;
  const firstName = profile?.full_name?.split(' ')[0] ?? '';

  // This route is public (it must be — its whole audience is blocked users),
  // so signing out doesn't redirect by itself: navigate explicitly.
  async function handleSignOut() {
    setLeaving(true);
    try { await signOut(); } catch { /* session may already be gone */ }
    navigate('/', { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm bg-card rounded-2xl shadow-sm border border-border p-8 text-center">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <Logo size={32} />
          <Wordmark className="text-sm text-foreground" />
        </div>

        <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
          <KeyRound size={26} className="text-amber-600" />
        </div>

        <h2 className="text-xl font-bold text-foreground mb-2">
          {noUnit ? t('noLicense.almostThere') : t('noLicense.noLicense')}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          {noUnit
            ? (firstName ? t('noLicense.noUnitBodyNamed', { name: firstName }) : t('noLicense.noUnitBody'))
            : (firstName ? t('noLicense.noLicenseBodyNamed', { name: firstName }) : t('noLicense.noLicenseBody'))}
        </p>

        <button
          onClick={handleSignOut}
          disabled={leaving}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
        >
          {leaving ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />} {t('nav.logout')}
        </button>
      </div>
    </div>
  );
}
