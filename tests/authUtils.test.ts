import { describe, it, expect } from 'vitest';
import { isAuthorizedOrganizer } from '../src/utils/authUtils';

describe('Organizer Authentication & Group Authorization (isAuthorizedOrganizer)', () => {
  const allowedList = [
    'info@suttonrepaircafe.org.uk',
    'admin@example.com',
    'organizer@gmail.com',
    '@suttonrepaircafe.org.uk',
    'volunteers.suttonrepaircafe.org.uk'
  ];

  it('authorizes exact named Google email addresses', () => {
    expect(isAuthorizedOrganizer('info@suttonrepaircafe.org.uk', allowedList)).toBe(true);
    expect(isAuthorizedOrganizer('admin@example.com', allowedList)).toBe(true);
    expect(isAuthorizedOrganizer('organizer@gmail.com', allowedList)).toBe(true);
  });

  it('handles case-insensitivity and whitespace gracefully', () => {
    expect(isAuthorizedOrganizer('  ADMIN@EXAMPLE.COM  ', allowedList)).toBe(true);
    expect(isAuthorizedOrganizer('Organizer@Gmail.Com', allowedList)).toBe(true);
    expect(isAuthorizedOrganizer('INFO@SUTTONREPAIRCAFE.ORG.UK', allowedList)).toBe(true);
  });

  it('authorizes accounts belonging to configured domain groups with @ prefix', () => {
    expect(isAuthorizedOrganizer('sarah@suttonrepaircafe.org.uk', allowedList)).toBe(true);
    expect(isAuthorizedOrganizer('dave.organizer@suttonrepaircafe.org.uk', allowedList)).toBe(true);
  });

  it('authorizes accounts belonging to configured naked domain groups', () => {
    expect(isAuthorizedOrganizer('team@volunteers.suttonrepaircafe.org.uk', allowedList)).toBe(true);
  });

  it('rejects unauthorized Google accounts', () => {
    expect(isAuthorizedOrganizer('random.stranger@gmail.com', allowedList)).toBe(false);
    expect(isAuthorizedOrganizer('hacker@evil.com', allowedList)).toBe(false);
    expect(isAuthorizedOrganizer('fake@otherrepaircafe.org.uk', allowedList)).toBe(false);
  });

  it('rejects partial domain spoofing', () => {
    // Should NOT match if domain is merely a substring but not ending with @domain
    expect(isAuthorizedOrganizer('attacker@notsuttonrepaircafe.org.uk', allowedList)).toBe(false);
  });

  it('permits all authenticated emails when allowed list is empty (default open policy)', () => {
    expect(isAuthorizedOrganizer('anyuser@example.com', [])).toBe(true);
    expect(isAuthorizedOrganizer('anyuser@example.com', undefined)).toBe(true);
  });

  it('rejects null, undefined, or empty email addresses', () => {
    expect(isAuthorizedOrganizer(null, allowedList)).toBe(false);
    expect(isAuthorizedOrganizer(undefined, allowedList)).toBe(false);
    expect(isAuthorizedOrganizer('', allowedList)).toBe(false);
    expect(isAuthorizedOrganizer('   ', allowedList)).toBe(false);
  });
});
