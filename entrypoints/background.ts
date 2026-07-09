import { TOGGLE_COMMAND, TOGGLE_MESSAGE } from '../lib/ipc';

// Single responsibility: relay the browser-level toggle shortcut to the active
// tab's content script. chrome.commands handles the keystroke itself, so the
// key works on pages that capture keydown and is rebindable at
// chrome://extensions/shortcuts.
export default defineBackground(() => {
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== TOGGLE_COMMAND) return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return;
    // No content script on chrome:// and store pages — ignore the rejection.
    browser.tabs.sendMessage(tab.id, { type: TOGGLE_MESSAGE }).catch(() => {});
  });
});
