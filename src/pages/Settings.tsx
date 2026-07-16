import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Camera, Loader2, Mail, ShieldCheck, User as UserIcon } from 'lucide-react';
import Cropper from 'react-easy-crop';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { uploadFile } from '@/lib/upload';
import { cropToSquare, type CropArea } from '@/lib/cropImage';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

/**
 * Your own account. Everything here is self-service and scoped to auth.uid() —
 * nothing on this page touches management access (grants) or residency
 * (memberships); those are admin concerns and live in People.
 */
export default function Settings() {
  const { t } = useTranslation();
  const { user, profile, refreshProfile } = useAuth();

  // ---- profile ----
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // ---- avatar ----
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // crop step
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<CropArea | null>(null);

  // ---- email ----
  const [email, setEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  // ---- password ----
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? '');
    setPhone(profile.phone ?? '');
    setNotifyEmail(profile.notify_email ?? true);
    setNotifyWhatsapp(profile.notify_whatsapp ?? false);
    setAvatarUrl(profile.avatar_url ?? null);
  }, [profile]);

  useEffect(() => { setEmail(user?.email ?? ''); }, [user]);

  const dirty =
    fullName !== (profile?.full_name ?? '')
    || phone !== (profile?.phone ?? '')
    || notifyEmail !== (profile?.notify_email ?? true)
    || notifyWhatsapp !== (profile?.notify_whatsapp ?? false);

  async function saveProfile() {
    if (!user) return;
    if (!fullName.trim()) { toast.error(t('settings.nameRequired')); return; }
    setSavingProfile(true);
    const { error } = await supabase.from('profiles').update({
      full_name: fullName.trim(),
      phone: phone.trim() || null,
      notify_email: notifyEmail,
      notify_whatsapp: notifyWhatsapp,
    }).eq('id', user.id);
    setSavingProfile(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('settings.profileSaved'));
    refreshProfile();
  }

  // Pick -> crop -> upload. Straight object-cover on a rectangular photo
  // centre-crops hard and reads as "zoomed in", so let people frame it.
  function onPickAvatar(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error(t('settings.imageOnly')); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error(t('settings.imageTooBig')); return; }
    setCropSrc(URL.createObjectURL(file));
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }

  async function confirmCrop() {
    if (!cropSrc || !croppedArea || !user) return;
    setUploadingAvatar(true);
    const blob = await cropToSquare(cropSrc, croppedArea);
    if (!blob) { setUploadingAvatar(false); toast.error(t('settings.uploadFailed')); return; }

    // 'avatars' is a PUBLIC bucket (0030) — `attachments` went private in 0025,
    // so a getPublicUrl() into it 404s. Folder must be the uid: the bucket's RLS
    // only lets you write under avatars/<your uid>/.
    const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
    const url = await uploadFile('avatars', user.id, file);
    if (!url) { setUploadingAvatar(false); toast.error(t('settings.uploadFailed')); return; }

    const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id);
    setUploadingAvatar(false);
    if (error) { toast.error(error.message); return; }

    URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
    setAvatarUrl(url);
    toast.success(t('settings.photoUpdated'));
    refreshProfile();
  }

  function cancelCrop() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  }

  async function removeAvatar() {
    if (!user) return;
    const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', user.id);
    if (error) { toast.error(error.message); return; }
    setAvatarUrl(null);
    toast.success(t('settings.photoRemoved'));
    refreshProfile();
  }

  // Changing an email is a two-step, verified flow: Supabase mails the NEW
  // address and the change only lands once that link is clicked.
  async function saveEmail() {
    if (!email.trim() || email.trim() === user?.email) return;
    setSavingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    setSavingEmail(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('settings.emailConfirmSent', { email: email.trim() }), { duration: 8000 });
  }

  async function savePassword() {
    if (pw1.length < 8) { toast.error(t('settings.pwTooShort')); return; }
    if (pw1 !== pw2) { toast.error(t('settings.pwMismatch')); return; }
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setSavingPw(false);
    if (error) { toast.error(error.message); return; }
    setPw1(''); setPw2('');
    toast.success(t('settings.pwUpdated'));
  }

  const initial = (profile?.full_name ?? '?').charAt(0).toUpperCase();

  return (
    <div className="max-w-2xl">
      {/* crop / zoom before upload */}
      <Modal open={!!cropSrc} onClose={cancelCrop} title={t('settings.cropTitle')} size="sm">
        <div className="space-y-4">
          <div className="relative w-full h-64 rounded-xl overflow-hidden bg-[#080b12]">
            {cropSrc && (
              <Cropper
                image={cropSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_area, areaPixels) => setCroppedArea(areaPixels)}
              />
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{t('settings.zoom')}</span>
            <input
              type="range" min={1} max={3} step={0.01}
              value={zoom}
              onChange={e => setZoom(Number(e.target.value))}
              className="flex-1 cursor-pointer"
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.cropHint')}</p>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={cancelCrop}>{t('common.cancel')}</Button>
            <Button onClick={confirmCrop} loading={uploadingAvatar}>{t('settings.usePhoto')}</Button>
          </div>
        </div>
      </Modal>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">{t('settings.title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('settings.subtitle')}</p>
      </div>

      {/* ---------- photo + identity ---------- */}
      <Card className="mb-5">
        <CardBody>
          <div className="flex items-center gap-5">
            <div className="relative flex-shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="w-20 h-20 rounded-full object-cover ring-2 ring-white/10" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#57D6E2] to-[#349ECD] flex items-center justify-center text-[#062330] text-2xl font-bold">
                  {initial}
                </div>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploadingAvatar}
                title={t('settings.changePhoto')}
                className="absolute -bottom-1 -end-1 w-8 h-8 rounded-full bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center hover:bg-white/20 transition cursor-pointer disabled:opacity-50"
              >
                {uploadingAvatar ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { onPickAvatar(e.target.files?.[0]); e.target.value = ''; }}
              />
            </div>

            <div className="min-w-0">
              <p className="font-semibold text-foreground truncate">{profile?.full_name}</p>
              <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
              {avatarUrl && (
                <button onClick={removeAvatar} className="text-xs text-muted-foreground hover:text-rose-400 transition cursor-pointer mt-1">
                  {t('settings.removePhoto')}
                </button>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ---------- details ---------- */}
      <Card className="mb-5">
        <CardBody>
          <div className="flex items-center gap-2 mb-4">
            <UserIcon size={16} className="text-[#7fe3ec]" />
            <p className="text-sm font-bold text-primary">{t('settings.yourDetails')}</p>
          </div>

          <div className="space-y-4">
            <Input label={t('settings.fullName')} value={fullName} onChange={e => setFullName(e.target.value)} />
            <Input label={t('settings.phone')} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+961 …" />

            {/* Read-only: your unit and access are set by your building admin. */}
            {profile?.apartment_number && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-muted-foreground">{t('settings.apartment')}</label>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-muted-foreground">
                  {profile.apartment_number}
                  <span className="text-xs text-muted-foreground ms-2">· {t('settings.managedByAdmin')}</span>
                </div>
              </div>
            )}

            <div className="pt-1 space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t('settings.notifications')}</p>
              <label className="flex items-center gap-2.5 text-sm text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={notifyEmail} onChange={e => setNotifyEmail(e.target.checked)} className="w-4 h-4 rounded cursor-pointer accent-primary" />
                {t('settings.notifyEmail')}
              </label>
              <label className="flex items-center gap-2.5 text-sm text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={notifyWhatsapp} onChange={e => setNotifyWhatsapp(e.target.checked)} className="w-4 h-4 rounded cursor-pointer accent-primary" />
                {t('settings.notifyWhatsapp')}
                <span className="text-xs text-foreground dark:text-white">({t('settings.comingSoon')})</span>
              </label>
            </div>

            <div className="flex justify-end pt-1">
              <Button onClick={saveProfile} loading={savingProfile} disabled={!dirty}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ---------- email ---------- */}
      <Card className="mb-5">
        <CardBody>
          <div className="flex items-center gap-2 mb-1">
            <Mail size={16} className="text-[#7fe3ec]" />
            <p className="text-sm font-bold text-primary">{t('settings.emailTitle')}</p>
          </div>
          <p className="text-xs text-muted-foreground mb-4">{t('settings.emailNote')}</p>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input label={t('settings.email')} type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <Button variant="secondary" onClick={saveEmail} loading={savingEmail} disabled={!email.trim() || email.trim() === user?.email}>
              {t('settings.updateEmail')}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ---------- password ---------- */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck size={16} className="text-[#7fe3ec]" />
            <p className="text-sm font-bold text-primary">{t('settings.passwordTitle')}</p>
          </div>
          <div className="space-y-4">
            <Input label={t('settings.newPassword')} type="password" value={pw1} onChange={e => setPw1(e.target.value)} autoComplete="new-password" />
            <Input label={t('settings.confirmPassword')} type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" />
            <div className="flex justify-end">
              <Button variant="secondary" onClick={savePassword} loading={savingPw} disabled={!pw1 || !pw2}>
                {t('settings.updatePassword')}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
