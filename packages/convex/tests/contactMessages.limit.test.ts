import { describe, expect, test } from 'bun:test';

import {
  CONTACT_MESSAGE_ADMIN_READ_LIMIT,
  contactMessageReadLimit,
} from '../convex/contactMessages';

describe('contact message admin read bounds', () => {
  test('keeps the native live window aligned with the web maximum', () => {
    expect(CONTACT_MESSAGE_ADMIN_READ_LIMIT).toBe(500);
    expect(contactMessageReadLimit(500)).toBe(CONTACT_MESSAGE_ADMIN_READ_LIMIT);
    expect(contactMessageReadLimit(5_000)).toBe(CONTACT_MESSAGE_ADMIN_READ_LIMIT);
  });

  test('uses a bounded, positive integer for optional web reads', () => {
    expect(contactMessageReadLimit()).toBe(100);
    expect(contactMessageReadLimit(Number.NaN)).toBe(100);
    expect(contactMessageReadLimit(0)).toBe(1);
    expect(contactMessageReadLimit(-20)).toBe(1);
    expect(contactMessageReadLimit(12.9)).toBe(12);
  });
});
