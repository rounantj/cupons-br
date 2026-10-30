import type { PageContext, SearchView } from "@cupons/contracts";

export type Request =
  | { type: "search"; page: PageContext }
  | { type: "poll"; id: string };

export type Reply = { ok: true; view: SearchView } | { ok: false; error: string };
