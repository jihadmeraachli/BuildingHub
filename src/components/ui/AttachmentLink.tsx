import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { getSignedUrl } from '@/lib/upload';

interface Props {
  url: string;
  label?: string;
  className?: string;
  icon?: React.ElementType;
  bucket?: string;
}

export function AttachmentLink({ url, label, className, icon: Icon = FileText, bucket }: Props) {
  const [loading, setLoading] = useState(false);

  async function open(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    const signed = await getSignedUrl(url, bucket);
    setLoading(false);
    window.open(signed, '_blank', 'noreferrer');
  }

  return (
    <a href="#" onClick={open} className={className}>
      {loading
        ? <Loader2 size={13} className="animate-spin" />
        : <Icon size={13} />}
      {label && <span>{label}</span>}
    </a>
  );
}
