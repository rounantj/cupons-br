/** Aplica migrations/*.sql em ordem, uma vez cada (tabela schema_migrations). */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DB_SCHEMA, getPool } from "./index";

async function main() {
  const pool = getPool();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${DB_SCHEMA}`);
  // extensão fica no public (padrão do Postgres); se o usuário não puder criar, ela precisa já existir
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public").catch((e: Error) => {
    throw new Error(`pgvector indisponível (${e.message}). Peça ao admin do banco: CREATE EXTENSION vector;`);
  });
  await pool.query(`SET search_path TO ${DB_SCHEMA}, public`);
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const dir = join(__dirname, "..", "migrations");
  const applied = new Set((await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(name)) continue;
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${DB_SCHEMA}, public`);
      await client.query("BEGIN");
      await client.query(readFileSync(join(dir, name), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      console.log(`migração aplicada: ${name}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`falha em ${name}: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
