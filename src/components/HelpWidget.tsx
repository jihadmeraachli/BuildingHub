import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle, MessageCircle, Send, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/**
 * "Ask Jad" — an AI help assistant that knows the app A to Z
 * (edge function help-chat: Claude Haiku over a baked-in app guide).
 * Conversation lives in component state only; nothing is stored.
 *
 * The chat modal is mounted ONCE by HelpProvider (at the shell level) so it
 * survives the mobile nav drawer closing, and any trigger — the header "?" or
 * the sidebar "Ask Jad" entry — opens it through useHelp().
 */

type Msg = { role: 'user' | 'assistant'; content: string };

const HelpContext = createContext<{ openHelp: () => void }>({ openHelp: () => {} });
export const useHelp = () => useContext(HelpContext);

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] ?? '';
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: 'user', content: q }];
    setMsgs(next);
    setInput('');
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('help-chat', {
        body: { messages: next, firstName },
      });
      if (error || !data?.answer) throw error ?? new Error('empty');
      setMsgs([...next, { role: 'assistant', content: data.answer }]);
    } catch {
      setMsgs([...next, { role: 'assistant', content: t('help.error') }]);
    } finally {
      setBusy(false);
    }
  }

  const suggestions = [t('help.suggest1'), t('help.suggest2'), t('help.suggest3'), t('help.suggest4')];

  return (
    <HelpContext.Provider value={{ openHelp: () => setOpen(true) }}>
      {children}

      <Modal open={open} onClose={() => setOpen(false)} title={t('help.title')}>
        <div className="flex flex-col" style={{ height: 'min(60vh, 480px)' }}>
          <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pe-1">
            {/* Welcome + suggested questions */}
            {msgs.length === 0 && (
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <Sparkles size={16} className="text-primary mt-1 shrink-0" />
                  <p className="text-sm text-muted-foreground">{t('help.intro')}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => ask(s)}
                      className="px-2.5 py-1.5 rounded-full border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer text-start"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <p
                  dir="auto"
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed',
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-accent text-accent-foreground',
                  )}
                >
                  {m.content}
                </p>
              </div>
            ))}

            {busy && (
              <div className="flex justify-start">
                <p className="bg-accent text-muted-foreground rounded-2xl px-3.5 py-2 text-sm animate-pulse">…</p>
              </div>
            )}
          </div>

          <form
            className="flex items-center gap-2 pt-3"
            onSubmit={(e) => { e.preventDefault(); ask(input); }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('help.placeholder')}
              maxLength={500}
              className="flex-1 min-w-0 rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Button type="submit" size="icon-sm" disabled={busy || !input.trim()} aria-label={t('help.send')}>
              <Send size={15} />
            </Button>
          </form>
          <div className="flex items-center justify-between gap-2 mt-2">
            <p className="text-[10px] text-muted-foreground/70">{t('help.disclaimer')}</p>
            {/* Human escalation: straight to the support WhatsApp. */}
            <a
              href={`https://wa.me/96178995443?text=${encodeURIComponent(t('help.humanPrefill'))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline shrink-0"
            >
              <MessageCircle size={12} /> {t('help.human')}
            </a>
          </div>
        </div>
      </Modal>
    </HelpContext.Provider>
  );
}

/** The header "?" trigger. */
export function HelpButton() {
  const { t } = useTranslation();
  const { openHelp } = useHelp();
  return (
    <Button variant="ghost" size="icon-sm" onClick={openHelp} aria-label={t('help.title')}>
      <HelpCircle size={16} />
    </Button>
  );
}
