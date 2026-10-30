// Build único -> dist/chrome (Chrome, Edge, Opera, Brave) e dist/firefox. O content script precisa ser IIFE (sem import).
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const API_URL = process.env.VITE_API_URL || "http://localhost:3000";
const out = resolve(root, "dist/build");
rmSync(resolve(root, "dist"), { recursive: true, force: true });

const common = { root, configFile: false, logLevel: "warn", define: { "import.meta.env.VITE_API_URL": JSON.stringify(API_URL), "process.env.NODE_ENV": '"production"' } };
const lib = (entry, name, format) => build({ ...common, plugins: [react()],
  build: { outDir: out, emptyOutDir: false, minify: true, lib: { entry: resolve(root, entry), formats: [format], name: "cuponsbr", fileName: () => name } } });

await lib("src/content/index.tsx", "content.js", "iife");
await lib("src/background.ts", "background.js", "es");
await build({ ...common, plugins: [react()], base: "./", publicDir: false,
  build: { outDir: resolve(out, "popup"), emptyOutDir: false, minify: true, rollupOptions: { input: resolve(root, "src/popup/index.html") } } });

const STORES = ["amazon.com.br", "mercadolivre.com.br", "shopee.com.br", "magazineluiza.com.br", "kabum.com.br", "casasbahia.com.br", "americanas.com.br"];
const matches = STORES.flatMap((d) => [`https://www.${d}/*`, `https://${d}/*`]).concat(["https://produto.mercadolivre.com.br/*"]);
const apiOrigin = new URL(API_URL).origin + "/*";

const base = {
  manifest_version: 3,
  name: "Cupons BR — cupons no produto que você vê",
  short_name: "Cupons BR",
  version: pkg.version,
  description: "Mostra cupons ativos e o melhor preço do produto que você está vendo na Amazon, Mercado Livre, Shopee e outras lojas.",
  icons: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" },
  action: { default_popup: "popup/src/popup/index.html", default_icon: { 16: "icons/16.png", 32: "icons/32.png" } },
  permissions: ["storage"],
  host_permissions: [apiOrigin],
  content_scripts: [{ matches, js: ["content.js"], run_at: "document_idle" }],
};

const targets = {
  chrome: { ...base, background: { service_worker: "background.js", type: "module" } },
  firefox: {
    ...base,
    background: { scripts: ["background.js"], type: "module" },
    browser_specific_settings: {
      gecko: {
        id: "cupons-br@ronanrodrigues",
        strict_min_version: "140.0",
        // a extensão envia ao nosso serviço a URL e os dados do produto da página de loja aberta
        data_collection_permissions: { required: ["browsingActivity", "websiteContent"] },
      },
    },
  },
};

for (const [name, manifest] of Object.entries(targets)) {
  const dir = resolve(root, "dist", name);
  mkdirSync(dir, { recursive: true });
  cpSync(out, dir, { recursive: true });
  cpSync(resolve(root, "public"), dir, { recursive: true });
  writeFileSync(resolve(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}
rmSync(out, { recursive: true, force: true });
console.log(`extensão ${pkg.version} -> dist/chrome, dist/firefox (API ${API_URL})`);
