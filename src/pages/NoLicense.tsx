import { useAuth } from '@/contexts/AuthContext';
import { Logo } from '@/components/ui/Logo';
import { KeyRound, LogOut } from 'lucide-react';

/**
 * Shown to residents whose unit has no active license (subscription expired,
 * trial ended, or the admin never assigned a license to their unit).
 * Enforcement itself is in the database — this is just the friendly wall.
 */
export default function NoLicense() {
  const { signOut, profile } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm bg-card rounded-2xl shadow-sm border border-border p-8 text-center">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <Logo size={32} />
          <span className="text-base font-bold text-foreground">Abniyah</span>
        </div>

        <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
          <KeyRound size={26} className="text-amber-600" />
        </div>

        <h2 className="text-xl font-bold text-foreground mb-2">No active license</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          {profile?.full_name ? `Hi ${profile.full_name.split(' ')[0]} — your` : 'Your'} unit
          doesn't currently have an active Abniyah license. Please contact your building
          admin to renew the subscription or assign a license to your unit.
        </p>

        <button
          onClick={signOut}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  );
}
