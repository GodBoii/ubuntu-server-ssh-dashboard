/** Motion helpers shared by the overlays, so JS timing follows the CSS tokens. */

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const cache = new Map<string, number>();

/** Reads a duration token such as `--modal-close-dur` and returns milliseconds. */
export function readMotionMs(token: string, fallback: number): number {
  if (prefersReducedMotion()) return 0;
  const cached = cache.get(token);
  if (cached !== undefined) return cached;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const value = raw.endsWith("ms") ? Number.parseFloat(raw) : raw.endsWith("s") ? Number.parseFloat(raw) * 1000 : Number.NaN;
  const resolved = Number.isFinite(value) ? value : fallback;
  cache.set(token, resolved);
  return resolved;
}
