/**
 * Runtime messages between the background command handler and content scripts.
 * The toggle shortcut lives in chrome.commands (browser-level), so macOS
 * Option-key composition (⌥M arrives in-page as 'µ') and pages that swallow
 * keydown can't break it — the background relays it here as a message.
 */

/** chrome.commands id — declared in the manifest, matched in the background handler. */
export const TOGGLE_COMMAND = 'toggle-magpoint' as const;

export const TOGGLE_MESSAGE = 'magpoint:toggle' as const;

export interface ToggleMessage {
  type: typeof TOGGLE_MESSAGE;
}

/** Narrow an unknown runtime message to the toggle command. */
export function isToggleMessage(msg: unknown): msg is ToggleMessage {
  return typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === TOGGLE_MESSAGE;
}
