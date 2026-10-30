import { Pool, PoolClient, QueryResultRow } from "pg";

let pool: Pool | null = null;

/** Schema próprio: o banco é compartilhado com outras aplicações, nada nosso vai para o "public". */
export const DB_SCHEMA = (process.env.DB_SCHEMA ?? "cupons").replace(/[^a-z0-9_]/gi, "");
/** Fila (pg-boss) também isolada em schema próprio. */
export const QUEUE_SCHEMA = `${DB_SCHEMA}_queue`;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL não definida");
    pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      ssl: process.env.DATABASE_SSL === "false" ? undefined : connectionString.includes("sslmode=") ? undefined : { rejectUnauthorized: false },
      // parâmetro de inicialização: vale antes da 1ª consulta. public só para enxergar o tipo "vector" da extensão.
      // (exige conexão direta ou pool em modo session; PgBouncer em modo transaction não aceita "options")
      options: `-c search_path=${DB_SCHEMA},public`,
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await getPool().query<T>(sql, params)).rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await query<T>(sql, params))[0] ?? null;
}

export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** pgvector aceita o literal '[0.1,0.2,...]' */
export const toVector = (v: number[]) => `[${v.join(",")}]`;

export { cached, cacheGet, cacheSet, cacheSweep } from "./cache";
export * from "./queue";
