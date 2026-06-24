import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Card, CardBody } from '@/components/ui/Card';
import { AlertTriangle, CalendarDays, Receipt, Users } from 'lucide-react';

interface Stats {
  openIssues: number;
  pendingApprovals: number;
  unpaidBills: number;
  upcomingMeetings: number;
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [stats, setStats] = useState<Stats>({ openIssues: 0, pendingApprovals: 0, unpaidBills: 0, upcomingMeetings: 0 });

  useEffect(() => {
    if (!profile?.building_id && profile?.role !== 'super_admin') return;

    async function loadStats() {
      const buildingId = profile?.building_id;
      const today = new Date().toISOString().split('T')[0];

      const [issuesRes, billsRes, meetingsRes] = await Promise.all([
        supabase.from('issues').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('billing_entries').select('id', { count: 'exact', head: true }).eq('status', 'unpaid'),
        supabase.from('meetings').select('id', { count: 'exact', head: true }).gte('meeting_date', today),
      ]);

      const next: Stats = {
        openIssues: issuesRes.count ?? 0,
        unpaidBills: billsRes.count ?? 0,
        upcomingMeetings: meetingsRes.count ?? 0,
        pendingApprovals: 0,
      };

      if (buildingId && (profile?.role === 'super_admin' || profile?.role === 'building_admin')) {
        const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true })
          .eq('building_id', buildingId).eq('status', 'pending');
        next.pendingApprovals = count ?? 0;
      }

      setStats(next);
    }

    loadStats();
  }, [profile]);

  const cards = [
    { label: t('dashboard.openIssues'), value: stats.openIssues, icon: AlertTriangle, color: 'text-orange-500', bg: 'bg-orange-50' },
    { label: t('dashboard.unpaidBills'), value: stats.unpaidBills, icon: Receipt, color: 'text-red-500', bg: 'bg-red-50' },
    { label: t('dashboard.upcomingMeetings'), value: stats.upcomingMeetings, icon: CalendarDays, color: 'text-blue-500', bg: 'bg-blue-50' },
    ...(profile?.role !== 'resident' ? [{ label: t('dashboard.pendingApprovals'), value: stats.pendingApprovals, icon: Users, color: 'text-yellow-500', bg: 'bg-yellow-50' }] : []),
  ];

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">
        {t('dashboard.welcome')}, {profile?.full_name?.split(' ')[0]}
      </h1>
      <p className="text-sm text-slate-500 mb-6">
        {profile?.apartment_number ? `Apartment ${profile.apartment_number}` : profile?.role?.replace('_', ' ')}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label}>
            <CardBody className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
                <Icon size={22} className={color} />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{value}</p>
                <p className="text-sm text-slate-500">{label}</p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
