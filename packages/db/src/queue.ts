/** Fila dentro do Postgres (pg-boss), em schema próprio: sem Redis. */
import PgBoss from "pg-boss";
import { QUEUE_SCHEMA } from "./index";

export const QUEUES = {
  collect: "search.collect",
  analyze: "search.analyze",
  link: "search.link",
  maintenance: "maintenance",
} as const;

export interface CollectJob { searchId: string; productId: string; mode: "full" | "refresh" }
export interface AnalyzeJob { searchId: string; productId: string; batch: unknown[] }
export interface LinkJob { searchId: string; productId: string }

let boss: PgBoss | null = null;

export async function getQueue(): Promise<PgBoss> {
  if (boss) return boss;
  const connectionString = process.env.DATABASE_URL!;
  boss = new PgBoss({
    connectionString,
    schema: QUEUE_SCHEMA,
    ssl: process.env.DATABASE_SSL === "false" || connectionString.includes("sslmode=") ? undefined : { rejectUnauthorized: false },
    max: 4,
  });
  boss.on("error", (e) => console.error("[pg-boss]", e.message));
  await boss.start();
  for (const name of Object.values(QUEUES)) await boss.createQueue(name);
  return boss;
}
