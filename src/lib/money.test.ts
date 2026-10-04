import { describe, expect, it, vi } from 'vitest';

// money.ts imports the i18n module for its default language; that module
// touches `document` on load and vitest runs in Node. Every call below passes
// the language explicitly, so the default is never needed.
vi.mock('@/i18n', () => ({ default: { language: 'en' } }));
import { fmtMoneyWhole } from './money';

describe('fmtMoneyWhole', () => {
  it('drops cents and rounds half away from zero', () => {
    expect(fmtMoneyWhole(14420, 'en')).toBe('$14,420');
    expect(fmtMoneyWhole(14420.49, 'en')).toBe('$14,420');
    expect(fmtMoneyWhole(14420.5, 'en')).toBe('$14,421');
    expect(fmtMoneyWhole(-14420.5, 'en')).toBe('\u2212\u2060$14,421'); // a real minus sign: never a line-break opportunity
  });
  it('never prints negative zero', () => {
    expect(fmtMoneyWhole(-0.2, 'en')).toBe('$0');
  });
  it('follows the reader\'s locale', () => {
    expect(fmtMoneyWhole(1234, 'fr')).toMatch(/1\s?234\s?\$/);
  });
});
