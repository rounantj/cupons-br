/** OpenAI via HTTP (sem SDK): saída JSON estrita por schema + embeddings. */

const API = "https://api.openai.com/v1";
const MODEL = () => process.env.OPENAI_MODEL || "gpt-5-nano";
const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536 dimensões = coluna vector(1536)

function key(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("OPENAI_API_KEY não definida");
  return k;
}

type JsonSchema = Record<string, any>;

/** Modo estrito exige additionalProperties=false e todas as chaves em required (opcionais viram nullable). */
export function strictSchema(schema: JsonSchema): JsonSchema {
  const s = structuredClone(schema);
  if (s.type === "object") {
    const props: JsonSchema = s.properties ?? {};
    const required = new Set<string>(s.required ?? []);
    for (const [k, v] of Object.entries(props)) {
      props[k] = strictSchema(v as JsonSchema);
      if (!required.has(k) && typeof props[k].type === "string") props[k].type = [props[k].type, "null"];
    }
    s.required = Object.keys(props);
    s.additionalProperties = false;
  } else if (s.type === "array" && s.items) {
    s.items = strictSchema(s.items);
  }
  return s;
}

export interface ChatUsage { prompt_tokens: number; completion_tokens: number }

export async function chatJson<T>(system: string, user: string, schema: JsonSchema): Promise<{ data: T; usage: ChatUsage | null }> {
  const model = MODEL();
  const body: JsonSchema = {
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    response_format: { type: "json_schema", json_schema: { name: "report", strict: true, schema: strictSchema(schema) } },
  };
  if (/^(gpt-5|o\d)/.test(model)) body.reasoning_effort = process.env.OPENAI_REASONING_EFFORT || "minimal";
  else body.temperature = 0;
  const r = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const json: any = await r.json();
  const msg = json.choices[0].message;
  if (msg.refusal) throw new Error(`OpenAI recusou: ${msg.refusal}`);
  return { data: JSON.parse(msg.content) as T, usage: json.usage ?? null };
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const r = await fetch(`${API}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts.map((t) => t.slice(0, 2000)) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`OpenAI embeddings ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const json: any = await r.json();
  return json.data.map((d: any) => d.embedding as number[]);
}
