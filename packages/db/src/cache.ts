/**
 * Cache no próprio Postgres (tabela UNLOGGED: sem WAL, rápida, some num crash — aceitável para cache).
 * Substitui o Redis: respostas de YouTube/Telegram, resolução de links, etc.
 */
import { one, query } from "./index";

export async function cacheGet<T>(key: string): Promise<T | null> {
  const row = await one<{ value: T }>("SELECT value FROM cache WHERE key = $1 AND expires_at > now()", [key]);
  return row?.value ?? null;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await query(
    `INSERT INTO cache (key, value, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
    [key, JSON.stringify(value), ttlSeconds],
  );
}

/** Busca no cache ou calcula e guarda. */
export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await fn();
  await cacheSet(key, value, ttlSeconds);
  return value;
}

export async function cacheSweep(): Promise<number> {
  return (await query("DELETE FROM cache WHERE expires_at < now() RETURNING 1")).length;
}
