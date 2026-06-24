import { supabase } from '@/lib/supabase';

/**
 * Upload a file to a Storage bucket and return its public URL (or null on failure).
 * Failures are swallowed so a missing attachment never blocks saving the record.
 */
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
