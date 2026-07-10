/**
 * The toggle shortcut lives in chrome.commands (browser-level), so macOS
 * Option-key composition (⌥M arrives in-page as 'µ') and pages that swallow
 * keydown can't break it. The command flips `masterEnabled` in settings
 * storage — the single source of truth every tab and the popup watch.
 */

/** chrome.commands id — declared in the manifest, matched in the background handler. */
export const TOGGLE_COMMAND = 'toggle-magpoint' as const;
