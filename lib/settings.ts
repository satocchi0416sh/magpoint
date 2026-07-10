/**
 * User settings — pure schema + helpers, no DOM and no extension APIs, so the
 * decision logic runs under the plain node test runner. Storage plumbing lives
 * in settings-store.ts; consumption lives in magnet.ts / the popup.
 *
 * Storage is the single source of truth: the popup and the ⌥M command both
 * write here, and every tab's content script watches and converges — no
 * per-tab volatile toggle state to drift out of sync.
 */

export type Strength = 'weak' | 'normal' | 'strong';

export interface Settings {
  masterEnabled: boolean;
  liteGlass: boolean; // drop the refraction lens + backdrop-filter, keep the rim
  strength: Strength;
  disabledHosts: string[]; // exact-hostname blocklist ("disable on this site")
}

export const DEFAULT_SETTINGS: Settings = {
  masterEnabled: true,
  liteGlass: false,
  strength: 'normal',
  disabledHosts: [],
};

/** Capture reach per preset (px). 'normal' matches the tuned maxRadius. */
export const STRENGTH_RADIUS: Record<Strength, number> = { weak: 80, normal: 120, strong: 180 };

export function maxRadiusFor(strength: Strength): number {
  return STRENGTH_RADIUS[strength];
}

/**
 * Exact-hostname match (lowercased). Deliberately no subdomain expansion:
 * "disable on this site" means the host in the address bar, so the host the
 * popup wrote and the reloaded page's location.hostname agree by definition.
 * (www.example.com and example.com are distinct — known trade-off.)
 */
export function isHostDisabled(hostname: string, disabledHosts: string[]): boolean {
  const h = hostname.toLowerCase();
  return disabledHosts.some((d) => d.toLowerCase() === h);
}

/** Add or remove a hostname, non-destructively, never duplicating. */
export function toggleHost(hostname: string, hosts: string[]): string[] {
  return isHostDisabled(hostname, hosts)
    ? hosts.filter((d) => d.toLowerCase() !== hostname.toLowerCase())
    : [...hosts, hostname];
}

/** What a tab should actually do: the master switch gated by the site blocklist. */
export function effectiveEnabled(s: Settings, hostname: string): boolean {
  return s.masterEnabled && !isHostDisabled(hostname, s.disabledHosts);
}

const STRENGTHS: readonly Strength[] = ['weak', 'normal', 'strong'];

/**
 * Coerce whatever storage returns into a valid Settings — first runs and
 * upgrades from builds that predate settings must behave like the defaults,
 * and unknown/corrupt fields must never poison the engine.
 */
export function normalizeSettings(v: unknown): Settings {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Partial<Record<keyof Settings, unknown>>;
  return {
    masterEnabled: typeof o.masterEnabled === 'boolean' ? o.masterEnabled : DEFAULT_SETTINGS.masterEnabled,
    liteGlass: typeof o.liteGlass === 'boolean' ? o.liteGlass : DEFAULT_SETTINGS.liteGlass,
    strength: STRENGTHS.includes(o.strength as Strength) ? (o.strength as Strength) : DEFAULT_SETTINGS.strength,
    disabledHosts: Array.isArray(o.disabledHosts) ? o.disabledHosts.filter((d): d is string => typeof d === 'string') : [],
  };
}
