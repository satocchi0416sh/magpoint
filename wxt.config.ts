import { defineConfig } from 'wxt';

import { TOGGLE_COMMAND } from './lib/ipc';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'MagPoint — magnetic cursor',
    short_name: 'MagPoint',
    description:
      'A magnetic cursor for the web: snaps your pointer to the nearest clickable element. Pointing assist built on HCI research.',
    homepage_url: 'https://github.com/satocchi0416sh/magpoint',
    // storage: settings sync; activeTab: the popup reads the current page's
    // hostname for "disable on this site". Both are warning-free permissions.
    permissions: ['storage', 'activeTab'],
    commands: {
      [TOGGLE_COMMAND]: {
        suggested_key: { default: 'Alt+M' },
        description: 'Toggle MagPoint on/off',
      },
    },
  },
});
