// Shared field validators - one rule per field type for the whole app
// (Register wizard, bulk imports). The real walls stay server-side (DB
// constraints, edge functions); these are the UX gates.

/** Basic email shape: something@domain.tld (TLD 2+ chars). */
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

/** Strip the visual separators people type into phone numbers. */
export const normalizePhone = (v: string) => v.replace(/[\s()-]/g, '');

/** Full international format: + then 7-15 digits (after normalization). */
export const isPhone = (v: string) => /^\+\d{7,15}$/.test(normalizePhone(v));
