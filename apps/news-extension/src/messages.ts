import type { NewsLookupView, NewsPage } from "@cupons/contracts";

export type Request = { type: "lookup"; page: NewsPage } | { type: "poll"; id: string };
export type Reply = { ok: true; view: NewsLookupView } | { ok: false; error: string };
