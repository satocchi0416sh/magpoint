import { TOGGLE_COMMAND } from '../lib/ipc';
import { normalizeSettings } from '../lib/settings';
import { settingsItem } from '../lib/settings-store';

// Single responsibility: the browser-level toggle shortcut flips masterEnabled
// in settings storage. Every tab (and an open popup) watches the same item and
// converges, so the shortcut and the popup can never disagree.
export default defineBackground(() => {
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== TOGGLE_COMMAND) return;
    const s = normalizeSettings(await settingsItem.getValue());
    // storage.sync write quota can reject a rapid burst; the next write converges.
    await settingsItem.setValue({ ...s, masterEnabled: !s.masterEnabled }).catch(() => {});
  });
});
