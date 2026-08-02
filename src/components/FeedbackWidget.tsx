import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MessageSquarePlus, ImagePlus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { uploadFile } from '@/lib/upload';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/**
 * In-app feedback (0068): a tester reports a bug/idea from the page they're
 * on; the file-feedback edge function turns it into a GitHub issue on the
 * Roadmap board with reporter, route, device and screenshot attached.
 * Rendered as a sidebar item; hidden for the public demo accounts.
 */
export function FeedbackWidget({ onOpenNavClose }: { onOpenNavClose?: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<'bug' | 'idea' | 'question'>('bug');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  async function send() {
    if (!user || message.trim().length < 5) { toast.error(t('feedback.tooShort')); return; }
    setSending(true);
    try {
      let screenshot_path: string | null = null;
      if (file) screenshot_path = await uploadFile('attachments', `feedback/${user.id}`, file);

      const { data: row, error } = await supabase.from('feedback').insert({
        user_id: user.id,
        category,
        message: message.trim(),
        page: location.pathname,
        device: navigator.userAgent,
        screenshot_path,
      }).select('id').single();
      if (error) throw error;

      const { error: fnErr } = await supabase.functions.invoke('file-feedback', { body: { id: row.id } });
      // The row is saved even if issue-filing hiccups — nothing is lost either way.
      if (fnErr) console.warn('file-feedback:', fnErr);

      toast.success(t('feedback.sent'));
      setOpen(false); setMessage(''); setFile(null); setCategory('bug');
    } catch {
      toast.error(t('feedback.failed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); onOpenNavClose?.(); }}
        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground w-full transition-colors cursor-pointer"
      >
        <MessageSquarePlus size={16} />
        {t('feedback.button')}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('feedback.title')} size="sm">
        <div className="space-y-4">
          <div className="flex gap-2">
            {(['bug', 'idea', 'question'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors cursor-pointer ${
                  category === c
                    ? 'border-primary text-primary bg-primary/10 font-semibold'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(`feedback.categories.${c}`)}
              </button>
            ))}
          </div>

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder={t('feedback.placeholder')}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />

          {file ? (
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
              <span className="truncate text-muted-foreground">{file.name}</span>
              <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground cursor-pointer"><X size={14} /></button>
            </div>
          ) : (
            <label className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer w-fit">
              <ImagePlus size={15} /> {t('feedback.addScreenshot')}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={send} loading={sending}>{t('feedback.send')}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
