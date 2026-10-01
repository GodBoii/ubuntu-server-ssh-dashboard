import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Section chunks are fetched the first time a section opens. Two things make
 * that fetch fail on a tab that has been open for a while:
 *
 * - a rebuild replaced the hashed files, so the old chunk URL is gone;
 * - Cloudflare Access expired and answered the chunk request with its login page.
 *
 * Browsers cache a failed module import per URL, so retrying in place rarely
 * helps. A single page reload fetches the new index.html and the new chunk
 * names. The timestamp guard stops a broken deploy from reloading in a loop.
 */

const reloadKey = "ubuntu-control:chunk-reload-at";
const reloadCooldownMs = 15_000;

const chunkErrorPattern =
  /dynamically imported module|importing a module script failed|error loading dynamically imported|failed to fetch|chunkloaderror|mime type|unable to preload css/i;

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || chunkErrorPattern.test(error.message);
}

function readLastReload(): number {
  try {
    return Number(window.sessionStorage.getItem(reloadKey) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Reloads once per cooldown window. Returns false when a reload was already tried recently. */
export function reloadForFreshChunks(): boolean {
  if (Date.now() - readLastReload() < reloadCooldownMs) return false;
  try {
    window.sessionStorage.setItem(reloadKey, String(Date.now()));
  } catch {
    // Private mode without storage still gets one reload per page load.
  }
  window.location.reload();
  return true;
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function loadWithRetry<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (first) {
    await wait(350);
    try {
      return await load();
    } catch (second) {
      // Hand the error to the boundary when a reload already happened recently.
      if (isChunkLoadError(second) && reloadForFreshChunks()) return new Promise<T>(() => undefined);
      throw second instanceof Error ? second : first;
    }
  }
}

export type LazySection<P extends object> = {
  Component: LazyExoticComponent<ComponentType<P>>;
  /** Warms the chunk without rendering it. Failures are ignored here and surface on real use. */
  preload: () => void;
};

export function lazySection<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): LazySection<P> {
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const once = () => {
    pending ??= loadWithRetry(load).catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
  return {
    Component: lazy(once),
    preload: () => {
      void once().catch(() => undefined);
    },
  };
}
