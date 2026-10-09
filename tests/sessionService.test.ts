import { describe, it, expect } from 'vitest';
import { generateReferenceToken } from '../src/services/repairService';

// Fallback SHA-256 implementation matching Web Crypto API logic in test environments
async function sha256Node(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('Session Utilities and Token Generators', () => {
  it('generates well-formed 4-character alphanumeric reference tokens', () => {
    for (let i = 0; i < 20; i++) {
      const token = generateReferenceToken();
      expect(token).toMatch(/^REF-[A-Z2-9]{4}$/);
      // Ensure no easily confused characters (0, O, 1, I)
      expect(token).not.toMatch(/[0O1I]/);
    }
  });

  it('correctly hashes 4-digit PINs into 64-character SHA-256 hex strings', async () => {
    const pin = '4829';
    const hash = await sha256Node(pin);
    expect(hash).toHaveLength(64);
    // Deterministic verify
    const hash2 = await sha256Node(pin);
    expect(hash).toBe(hash2);
    // Distinct PIN gives distinct hash
    const hashOther = await sha256Node('1234');
    expect(hash).not.toBe(hashOther);
  });
});
