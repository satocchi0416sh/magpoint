import { describe, expect, it } from 'vitest';
import { isToggleMessage, TOGGLE_MESSAGE } from './ipc';

describe('isToggleMessage — background → content toggle relay', () => {
  it('accepts the message the background sends', () => {
    expect(isToggleMessage({ type: TOGGLE_MESSAGE })).toBe(true);
  });

  it('rejects other runtime messages and junk', () => {
    // content scripts share the runtime.onMessage bus with any future messages —
    // the guard must not toggle on unrelated traffic
    expect(isToggleMessage({ type: 'magpoint:other' })).toBe(false);
    expect(isToggleMessage({})).toBe(false);
    expect(isToggleMessage(null)).toBe(false);
    expect(isToggleMessage(undefined)).toBe(false);
    expect(isToggleMessage('magpoint:toggle')).toBe(false); // bare string is not a message object
  });
});
