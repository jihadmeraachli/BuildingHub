import { useEffect, useState } from 'react';
import { Menu, Bell, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { setLanguage } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import type { Notification } from '@/types';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  const unread = notifs.filter(n => !n.is_read).length;

  async function load() {
    if (!user) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
    setNotifs((data as Notification[]) ?? []);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  async function onNotifOpen(open: boolean) {
    setNotifOpen(open);
    if (open && unread > 0) {
      setNotifs(prev => prev.map(n => ({ ...n, is_read: true })));
      await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
    }
  }

  function toggleLang() { setLanguage(i18n.language === 'ar' ? 'en' : 'ar'); }

  return (
    <header className="h-14 shrink-0 flex items-center justify-between gap-2 px-4 lg:px-6 border-b border-border bg-background">
      {/* Mobile menu trigger */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onMenuClick}
        className="lg:hidden"
        aria-label="Open menu"
      >
        <Menu size={18} />
      </Button>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        {/* Language toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleLang}
          className="gap-1.5 text-muted-foreground text-xs font-medium"
        >
          <Globe size={15} />
          {i18n.language === 'ar' ? 'EN' : 'عر'}
        </Button>

        {/* Notifications */}
        <Popover open={notifOpen} onOpenChange={onNotifOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="relative" aria-label={t('nav.notifications')}>
              <Bell size={16} />
              {unread > 0 && (
                <span className="absolute -top-0.5 -end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-semibold">{t('nav.notifications')}</span>
              {unread === 0 && notifs.length > 0 && (
                <span className="text-[10px] text-muted-foreground">{t('common.allRead')}</span>
              )}
            </div>
            <Separator />
            {notifs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t('common.noNotifications')}</p>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
                {notifs.map(n => (
                  <div
                    key={n.id}
                    className={cn('px-4 py-3 transition-colors', !n.is_read && 'bg-accent/50')}
                  >
                    <p className="text-sm font-medium leading-snug">{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>}
                    <p className="text-[11px] text-muted-foreground/60 mt-1">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}
