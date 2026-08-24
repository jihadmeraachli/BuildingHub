import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  /** Red confirm button — the default for a delete/cancel/undo action. */
  destructive?: boolean;
  loading?: boolean;
}

/**
 * The in-app replacement for window.confirm(). Same dark chrome as every
 * other modal in the app (Modal.tsx), a red confirm button only when the
 * action actually is destructive, and — unlike the browser dialog it
 * replaces — this one still works inside a sandboxed iframe.
 */
export function ConfirmModal({ open, onClose, onConfirm, title, message, confirmLabel, destructive = true, loading }: ConfirmModalProps) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="tinted"
            loading={loading}
            onClick={onConfirm}
            className={destructive ? 'bg-destructive/15 text-destructive border-destructive/40 hover:bg-destructive/25' : undefined}
          >
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
