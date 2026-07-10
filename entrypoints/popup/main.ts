import { TOGGLE_COMMAND } from '../../lib/ipc';
import {
  effectiveEnabled,
  isHostDisabled,
  normalizeSettings,
  toggleHost,
  type Settings,
  type Strength,
} from '../../lib/settings';
import { settingsItem } from '../../lib/settings-store';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const master = $<HTMLInputElement>('master');
const site = $<HTMLInputElement>('site');
const lite = $<HTMLInputElement>('lite');
const siteRow = $('site-row');
const hostEl = $('host');
const segButtons = Array.from($('strength').querySelectorAll<HTMLButtonElement>('button'));

let current: Settings = normalizeSettings(undefined);
let hostname = ''; // empty on chrome:// / store pages — the site row is unavailable there

function render(): void {
  master.checked = current.masterEnabled;
  lite.checked = current.liteGlass;
  site.checked = hostname !== '' && isHostDisabled(hostname, current.disabledHosts);
  for (const b of segButtons) b.setAttribute('aria-checked', String(b.dataset.strength === current.strength));
  document.body.classList.toggle('off', hostname !== '' ? !effectiveEnabled(current, hostname) : !current.masterEnabled);
}

/** Optimistic: update the UI immediately, then persist; the watch below reconciles. */
function commit(next: Settings): void {
  current = next;
  render();
  settingsItem.setValue(next).catch(() => {}); // sync write quota can reject a burst; next write converges
}

async function init(): Promise<void> {
  current = normalizeSettings(await settingsItem.getValue());

  // listeners attach only after the stored settings are loaded — a click during
  // the load window must never commit a DEFAULT_SETTINGS-based object (it would
  // silently wipe the stored blocklist)
  master.addEventListener('change', () => commit({ ...current, masterEnabled: master.checked }));
  lite.addEventListener('change', () => commit({ ...current, liteGlass: lite.checked }));
  site.addEventListener('change', () => {
    if (hostname) commit({ ...current, disabledHosts: toggleHost(hostname, current.disabledHosts) });
  });
  for (const b of segButtons) {
    b.addEventListener('click', () => commit({ ...current, strength: b.dataset.strength as Strength }));
  }

  // activeTab (granted by opening the popup) exposes the page's URL
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab?.url ?? '');
    if (url.protocol === 'http:' || url.protocol === 'https:') hostname = url.hostname;
  } catch {
    // no usable URL — leave hostname empty
  }
  if (hostname) {
    hostEl.textContent = hostname;
  } else {
    siteRow.classList.add('unavailable');
    hostEl.textContent = 'not available on this page';
  }

  // rebind-aware shortcut display (replaces the old hardcoded badge text)
  const commands = await browser.commands.getAll();
  const key = commands.find((c) => c.name === TOGGLE_COMMAND)?.shortcut;
  $('shortcut').textContent = key || 'unset';

  // follow external writes while open (⌥M, another window's popup)
  settingsItem.watch((s) => {
    current = normalizeSettings(s);
    render();
  });
  render();
}

void init();
