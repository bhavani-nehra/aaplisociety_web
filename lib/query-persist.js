// lib/query-persist.js — keeps the react-query cache and the signed-in user
// in sessionStorage so a browser refresh renders cached data instantly
// (stale-while-revalidate) instead of blanking and refetching everything.
// sessionStorage = per tab and gone when the tab closes; cleared on logout
// and on login. dataUpdatedAt survives, so data still fresh within a query's
// staleTime is not refetched at all.
import { dehydrate, hydrate } from "@tanstack/react-query";

const CACHE_KEY = "aapli:rq-cache";
const USER_KEY = "aapli:user";
const MAX_AGE_MS = 30 * 60 * 1000;
const SAVE_DELAY_MS = 500;

const read = (k) => {
  try {
    return JSON.parse(sessionStorage.getItem(k) || "null");
  } catch {
    return null;
  }
};

export function readCachedUser() {
  return read(USER_KEY);
}
export function writeCachedUser(user) {
  try {
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {}
}
export function clearPersistedSession() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch {}
}

/**
 * Fill the client from storage. Call synchronously when the client is created
 * (before any query mounts) so pages find cached data on their first render.
 */
export function restoreQueryClient(queryClient) {
  if (typeof window === "undefined") return queryClient;
  const saved = read(CACHE_KEY);
  if (saved && Date.now() - saved.savedAt < MAX_AGE_MS) {
    try {
      hydrate(queryClient, saved.state);
    } catch {}
  }
  return queryClient;
}

/** Save cache changes to storage (debounced). Returns unsubscribe. */
export function persistQueryClient(queryClient) {
  if (typeof window === "undefined") return () => {};
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const state = dehydrate(queryClient, {
          shouldDehydrateQuery: (q) => q.state.status === "success",
        });
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), state }));
      } catch {} // quota / non-serialisable — just skip persisting
    }, SAVE_DELAY_MS);
  };
  const unsub = queryClient.getQueryCache().subscribe(save);
  return () => {
    clearTimeout(timer);
    unsub();
  };
}
