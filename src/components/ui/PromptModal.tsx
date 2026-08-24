import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface PromptModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  title: string;
  label: string;
  defaultValue?: string;
  type?: 'text' | 'date';
  loading?: boolean;
}

/** The in-app replacement for window.prompt() — same dark chrome as every
 *  other modal, and unlike the browser dialog it replaces, this one still
 *  works inside a sandboxed iframe. */
export function PromptModal({ open, onClose, onSubmit, title, label, defaultValue = '', type = 'text', loading }: PromptModalProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);
  useEffect(() => { if (open) setValue(defaultValue); }, [open, defaultValue]);

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        <Input label={label} type={type} value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="tinted" loading={loading} onClick={() => onSubmit(value)}>{t('common.confirm')}</Button>
        </div>
      </div>
    </Modal>
  );
}
