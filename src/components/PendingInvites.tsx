import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Home, Check, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface Invite {
  id: string;
  unit_label: string;
  building_name: string;
  tenure: string;
  invited_by: string;
  created_at: string;
}

/**
 * Consent banner (0053): unit invitations addressed to the signed-in user.
 * An admin proposing "add this person to unit X" only becomes a membership
 * when the person accepts here.
 */
export function PendingInvites() {
  const { t } = useTranslation();
  const { user, refreshProfile } = useAuth();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState('');

  async function load() {
    const { data } = await supabase.rpc('my_membership_invites');
    setInvites(((data ?? []) as Invite[]));
  }

  useEffect(() => { if (user) load(); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function respond(id: string, accept: boolean) {
    setBusy(id);
    const { error } = await supabase.rpc('respond_membership_invite', { p_invite: id, p_accept: accept });
    setBusy('');
    if (error) { toast.error(error.message); return; }
    toast.success(accept ? t('invites.accepted') : t('invites.declined'));
    await load();
    if (accept) await refreshProfile(); // memberships changed — reload access
  }

  if (!invites.length) return null;

  return (
    <div className="space-y-2">
      {invites.map((inv) => (
        <Card key={inv.id} className="gap-0 py-0 border-primary/40 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <Home size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm">
                  {t('invites.title', { unit: inv.unit_label, building: inv.building_name })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('invites.byAs', {
                    inviter: inv.invited_by,
                    tenure: inv.tenure === 'tenant' ? t('users.tenureTenant') : t('users.tenureOwner'),
                  })}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="secondary" loading={busy === inv.id} onClick={() => respond(inv.id, false)}>
                  <X size={14} /> {t('invites.decline')}
                </Button>
                <Button size="sm" variant="tinted" loading={busy === inv.id} onClick={() => respond(inv.id, true)}>
                  <Check size={14} /> {t('invites.accept')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
