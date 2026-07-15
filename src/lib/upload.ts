import { supabase } from '@/lib/supabase';

export async function uploadFile(bucket: string, folder: string, file: File): Promise<string | null> {
  try {
    const safe = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${folder}/${Date.now()}-${safe}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file);
    if (error) return null;
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

// Extracts the storage path from a stored URL or passthrough a bare path,
// then returns a short-lived signed URL (1 hour). Falls back to the original
// value if signing fails so the UI never hard-breaks.
export async function getSignedUrl(urlOrPath: string, bucket = 'attachments', expiresIn = 3600): Promise<string> {
  try {
    const marker = `/object/public/${bucket}/`;
    const path = urlOrPath.includes(marker)
      ? urlOrPath.split(marker)[1]
      : urlOrPath.replace(new RegExp(`^${bucket}/`), '');
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
    return data?.signedUrl ?? urlOrPath;
  } catch {
    return urlOrPath;
  }
}
