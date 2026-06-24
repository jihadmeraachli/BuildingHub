import { Menu, Bell, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { setLanguage } from '@/i18n';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  function toggleLang() {
    setLanguage(i18n.language === 'ar' ? 'en' : 'ar');
  }

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-6">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      <div className="flex-1 lg:flex-none" />

      <div className="flex items-center gap-2">
        <button
          onClick={toggleLang}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition cursor-pointer"
          title={t('common.filter')}
        >
          <Globe size={16} />
          {i18n.language === 'ar' ? 'EN' : 'عر'}
        </button>

        <button className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition cursor-pointer" aria-label={t('nav.notifications')}>
          <Bell size={18} />
        </button>

        <div className="flex items-center gap-2 ps-2 border-s border-slate-200">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-semibold">
            {profile?.full_name?.charAt(0).toUpperCase() ?? '?'}
          </div>
          <div className="hidden sm:block text-sm">
            <p className="font-medium text-slate-900 leading-none">{profile?.full_name}</p>
            <p className="text-slate-500 text-xs mt-0.5">{profile?.apartment_number ?? profile?.role}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
