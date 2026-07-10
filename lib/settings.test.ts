import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  effectiveEnabled,
  isHostDisabled,
  maxRadiusFor,
  normalizeSettings,
  toggleHost,
  type Settings,
} from './settings';

const s = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

describe('maxRadiusFor — strength presets (AC4)', () => {
  it('maps weak < normal < strong onto capture reach', () => {
    expect(maxRadiusFor('weak')).toBe(80);
    expect(maxRadiusFor('normal')).toBe(120); // the tuned default radius
    expect(maxRadiusFor('strong')).toBe(180);
  });
});

describe('isHostDisabled — exact-hostname blocklist (AC2)', () => {
  it('matches the exact host and nothing else', () => {
    expect(isHostDisabled('x.com', ['x.com'])).toBe(true);
    expect(isHostDisabled('amazon.co.jp', ['x.com'])).toBe(false);
    expect(isHostDisabled('anything.example', [])).toBe(false);
  });

  it('is case-insensitive on both sides', () => {
    expect(isHostDisabled('X.com', ['x.com'])).toBe(true);
    expect(isHostDisabled('x.com', ['X.COM'])).toBe(true);
  });

  it('does not expand to subdomains — "this site" means the address-bar host', () => {
    expect(isHostDisabled('mail.google.com', ['google.com'])).toBe(false);
    expect(isHostDisabled('google.com', ['mail.google.com'])).toBe(false);
  });
});

describe('toggleHost', () => {
  it('adds an absent host and removes a present one', () => {
    expect(toggleHost('x.com', [])).toEqual(['x.com']);
    expect(toggleHost('x.com', ['x.com', 'other.net'])).toEqual(['other.net']);
  });

  it('never duplicates and does not mutate its input', () => {
    const input = ['x.com'];
    const removed = toggleHost('X.COM', input); // case-insensitive removal
    expect(removed).toEqual([]);
    expect(input).toEqual(['x.com']); // untouched
    expect(toggleHost('x.com', toggleHost('x.com', ['x.com']))).toEqual(['x.com']); // round-trips to one entry
  });
});

describe('effectiveEnabled — master gated by the site blocklist (AC1/AC2)', () => {
  it('is false whenever the master is off', () => {
    expect(effectiveEnabled(s({ masterEnabled: false }), 'x.com')).toBe(false);
    expect(effectiveEnabled(s({ masterEnabled: false, disabledHosts: ['x.com'] }), 'x.com')).toBe(false);
  });

  it('is false on a blocked host and true elsewhere', () => {
    const withBlock = s({ disabledHosts: ['x.com'] });
    expect(effectiveEnabled(withBlock, 'x.com')).toBe(false);
    expect(effectiveEnabled(withBlock, 'amazon.co.jp')).toBe(true);
  });
});

describe('normalizeSettings — first runs and corrupt storage never poison the engine', () => {
  it('returns defaults for missing/invalid storage (upgrade from pre-settings builds, AC5)', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('junk')).toEqual(DEFAULT_SETTINGS);
  });

  it('fills missing fields around a partial object', () => {
    expect(normalizeSettings({ strength: 'weak' })).toEqual({ ...DEFAULT_SETTINGS, strength: 'weak' });
    expect(normalizeSettings({ masterEnabled: false })).toEqual({ ...DEFAULT_SETTINGS, masterEnabled: false });
  });

  it('rejects unknown strength values and non-boolean flags', () => {
    expect(normalizeSettings({ strength: 'ultra' }).strength).toBe('normal');
    expect(normalizeSettings({ masterEnabled: 'yes' }).masterEnabled).toBe(true);
    expect(normalizeSettings({ liteGlass: 1 }).liteGlass).toBe(false);
  });

  it('sanitizes a corrupt disabledHosts', () => {
    expect(normalizeSettings({ disabledHosts: 'x.com' }).disabledHosts).toEqual([]);
    expect(normalizeSettings({ disabledHosts: ['x.com', 42, null, 'y.dev'] }).disabledHosts).toEqual(['x.com', 'y.dev']);
  });
});
