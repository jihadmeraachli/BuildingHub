import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Bell, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { topRole } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { setLanguage } from '@/i18n';
import type { Notification } from '@/types';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { t, i18n } = useTranslation();
  const { profile, user, isPlatformAdmin, grants } = useAuth();

  // Derived from ROLE_RANK, so new roles (compound_admin, building_super…) are
  // labelled automatically. Never falls back to legacy profiles.role — that
  // field is not what RLS enforces.
  const top = topRole(grants.map(g => g.role));
  const displayRole = isPlatformAdmin
    ? t('users.roles.platform_admin')
    : top ? t(`users.roles.${top}`, { defaultValue: top }) : t('users.roles.resident');
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unread = notifs.filter((n) => !n.is_read).length;

  async function load() {
    if (!user) return;
    const { data } = await supabase.from('notifications').select('*')
      .order('created_at', { ascending: false }).limit(30);
    setNotifs((data as Notification[]) ?? []);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  // close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      // mark all read
      setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
      await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
    }
  }

  function toggleLang() { setLanguage(i18n.language === 'ar' ? 'en' : 'ar'); }

  return (
    // relative z-10: backdrop-blur makes this a stacking context, so without an
    // explicit z-index <main> (a later sibling) paints over it and swallows the
    // notification dropdown. Stays below the sidebar drawer (z-20/z-30).
    <header className="relative z-10 h-16 bg-[#0b0f17]/80 backdrop-blur border-b border-white/10 flex items-center justify-between px-4 lg:px-6">
      <button onClick={onMenuClick} className="lg:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer" aria-label="Open menu">
        <Menu size={20} />
      </button>

      <div className="flex-1 lg:flex-none" />

      <div className="flex items-center gap-2">
        <button onClick={toggleLang} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm text-slate-600 hover:bg-slate-100 transition cursor-pointer">
          <Globe size={16} />
          {i18n.language === 'ar' ? 'EN' : 'عر'}
        </button>

        <div className="relative" ref={ref}>
          <button onClick={toggle} className="relative p-2 rounded-xl text-slate-500 hover:bg-slate-100 transition cursor-pointer" aria-label={t('nav.notifications')}>
            <Bell size={18} />
            {unread > 0 && (
              <span className="absolute -top-0.5 -end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {open && (
            <div className="absolute end-0 mt-2 w-80 max-h-[70vh] overflow-y-auto bg-white rounded-2xl shadow-xl ring-1 ring-slate-900/5 z-50">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">{t('nav.notifications')}</span>
              </div>
              {notifs.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">{t('common.noNotifications')}</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {notifs.map((n) => (
                    <div key={n.id} className="px-4 py-3 hover:bg-slate-50">
                      <p className="text-sm font-medium text-slate-900">{n.title}</p>
                      {n.body && <p className="text-xs text-slate-500 mt-0.5">{n.body}</p>}
                      <p className="text-[11px] text-slate-400 mt-1">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* click your name -> your account settings */}
        <Link
          to="/settings"
          title={t('settings.title')}
          className="flex items-center gap-2.5 ps-2.5 ms-1 border-s border-slate-200 rounded-e-xl py-1 pe-1 hover:bg-white/5 transition cursor-pointer"
        >
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#57D6E2] to-[#349ECD] flex items-center justify-center text-[#062330] text-sm font-bold">
              {profile?.full_name?.charAt(0).toUpperCase() ?? '?'}
            </div>
          )}
          <div className="hidden sm:block text-sm leading-tight">
            <p className="font-medium text-slate-900">{profile?.full_name}</p>
            <p className="text-slate-500 text-xs mt-0.5">
              {profile?.apartment_number ?? displayRole}
            </p>
          </div>
        </Link>
      </div>
    </header>
  );
}
