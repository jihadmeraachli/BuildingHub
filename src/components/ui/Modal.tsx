import { type ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };

/**
 * The app's dialog. From sm up it is a centred card. On a phone it is a
 * BOTTOM SHEET: full width, rounded top, sliding up from the home indicator,
 * with a grab handle — the shape every phone form takes, and the one that
 * keeps the first field and the primary button in thumb reach. The sheet
 * caps at 92% of the visible height (dvh, so the keyboard and browser chrome
 * are accounted for) and scrolls inside; the header stays put.
 */
export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative bg-popover text-popover-foreground shadow-2xl ring-1 ring-border w-full ${sizeClasses[size]}
          rounded-t-3xl sm:rounded-2xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col
          pb-[env(safe-area-inset-bottom)] sm:pb-0 animate-in slide-in-from-bottom-8 sm:slide-in-from-bottom-0 sm:zoom-in-95 fade-in duration-200`}
      >
        {/* grab handle: phone only */}
        <div className="sm:hidden flex justify-center pt-2.5 -mb-1" aria-hidden="true">
          <span className="w-9 h-1 rounded-full bg-muted-foreground/35" />
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="-me-2 p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  );
}
