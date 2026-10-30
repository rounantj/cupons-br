/** CSS isolado no shadow DOM: a loja não interfere no visual e vice-versa. */
export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap {
  --bg: #ffffff; --ink: #14181f; --muted: #5f6b7a; --line: #e7eaef; --chip: #f2f5f8;
  --accent: #0e9f6e; --accent-ink: #ffffff; --accent-soft: #e6f6ef; --shadow: 0 18px 50px rgba(16, 24, 40, .18), 0 2px 6px rgba(16, 24, 40, .08);
  position: fixed; top: 16px; right: 16px; z-index: 2147483647;
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink);
}
@media (prefers-color-scheme: dark) {
  .wrap { --bg: #161b22; --ink: #e8edf3; --muted: #9aa6b4; --line: #2a313b; --chip: #202731; --accent: #34d399; --accent-ink: #06231a; --accent-soft: #10291f;
          --shadow: 0 18px 50px rgba(0,0,0,.5); }
}
.card {
  width: 340px; max-width: calc(100vw - 32px); background: var(--bg); border: 1px solid var(--line); border-radius: 16px;
  box-shadow: var(--shadow); overflow: hidden; animation: in .35s cubic-bezier(.2,.8,.2,1);
}
@keyframes in { from { opacity: 0; transform: translateY(-8px) scale(.98); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .card, .pill, .pill .spin { animation: none; } }
.head { display: flex; align-items: center; gap: 10px; padding: 12px 12px 10px 14px; }
.logo { width: 28px; height: 28px; border-radius: 8px; background: var(--accent); color: var(--accent-ink); display: grid; place-items: center; font-weight: 800; font-size: 14px; flex: none; }
.title { flex: 1; min-width: 0; }
.title b { display: block; font-size: 14px; }
.title span { display: block; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon { all: unset; cursor: pointer; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; color: var(--muted); font-size: 16px; }
.icon:hover { background: var(--chip); color: var(--ink); }
.icon:focus-visible, .btn:focus-visible, .copy:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.best { margin: 0 12px; padding: 12px; border-radius: 12px; background: var(--accent-soft); }
.best .row { display: flex; align-items: center; gap: 8px; }
.pct { font-size: 22px; font-weight: 800; color: var(--accent); letter-spacing: -.02em; }
.meta { color: var(--muted); font-size: 12px; }
.code { font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .04em; padding: 6px 10px; border-radius: 8px;
        border: 1.5px dashed var(--accent); background: var(--bg); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.copy { all: unset; cursor: pointer; padding: 7px 12px; border-radius: 8px; background: var(--accent); color: var(--accent-ink); font-weight: 700; font-size: 12px; }
.copy.done { background: var(--ink); color: var(--bg); }
.list { padding: 6px 12px 0; }
.item { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-top: 1px solid var(--line); }
.item:first-child { border-top: none; }
.item .c { font: 600 12px ui-monospace, Menlo, monospace; }
.item .l { flex: 1; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mini { all: unset; cursor: pointer; font-size: 11px; font-weight: 700; color: var(--accent); padding: 3px 6px; border-radius: 6px; }
.mini:hover { background: var(--accent-soft); }
.section { padding: 10px 12px 2px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.buy { padding: 4px 12px 0; display: grid; gap: 6px; }
.btn { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--line); }
.btn:hover { border-color: var(--accent); }
.btn .p { flex: 1; font-weight: 600; }
.btn .v { font-weight: 800; }
.btn .here { font-size: 10px; color: var(--muted); font-weight: 600; }
.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
.origin { margin: 8px 12px 0; padding: 8px 10px; border-radius: 10px; background: var(--chip); font-size: 12px; color: var(--muted); }
.origin a { color: var(--accent); font-weight: 600; text-decoration: none; }
.foot { display: flex; justify-content: space-between; gap: 8px; padding: 10px 14px 12px; color: var(--muted); font-size: 11px; }
.foot button { all: unset; cursor: pointer; text-decoration: underline; }
.pill { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 8px 12px 8px 8px; border-radius: 999px; background: var(--bg);
        border: 1px solid var(--line); box-shadow: var(--shadow); font-weight: 700; animation: in .3s ease; }
.pill .logo { width: 24px; height: 24px; font-size: 12px; border-radius: 999px; }
.pill.searching { cursor: default; padding-right: 4px; color: var(--muted); }
.pill .spin { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .45; transform: scale(.9); } }
`;
