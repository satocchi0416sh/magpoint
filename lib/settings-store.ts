/**
 * The one storage item behind Settings (chrome.storage.sync via WXT). Kept
 * apart from settings.ts so the pure logic stays importable without any
 * extension API in scope (vitest runs it under plain node).
 */

import { storage } from 'wxt/utils/storage';

import { DEFAULT_SETTINGS, type Settings } from './settings';

export const settingsItem = storage.defineItem<Settings>('sync:settings', { fallback: DEFAULT_SETTINGS });
