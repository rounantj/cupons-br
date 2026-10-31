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
  build: { outDir: out, emptyOutDir: false, minify: true, lib: { entry: resolve(root, entry), formats: [format], name: "panorama", fileName: () => name } } });

await lib("src/content/index.ts", "content.js", "iife");
await lib("src/background.ts", "background.js", "es");
// painel: página da extensão aberta num iframe sobre a matéria (panel/index.html)
await build({ ...common, root: resolve(root, "src/panel"), plugins: [react()], base: "./", publicDir: false,
  build: { outDir: resolve(out, "panel"), emptyOutDir: false, minify: true } });

// portais de notícia com matérias detectáveis (mesma lista do registro de fontes, content_sources)
const NEWS = [
  "g1.globo.com", "oglobo.globo.com", "valor.globo.com", "ge.globo.com", "gshow.globo.com", "extra.globo.com", "revistagalileu.globo.com",
  "www1.folha.uol.com.br", "piaui.folha.uol.com.br", "noticias.uol.com.br", "www.uol.com.br", "economia.uol.com.br", "www.band.uol.com.br",
  "www.estadao.com.br", "www.cnnbrasil.com.br", "www.bbc.com", "agenciabrasil.ebc.com.br", "www.metropoles.com", "www.poder360.com.br",
  "noticias.r7.com", "www.terra.com.br", "sbtnews.sbt.com.br", "www.correiobraziliense.com.br", "www.em.com.br", "gauchazh.clicrbs.com.br",
  "www.otempo.com.br", "www.opovo.com.br", "www.diariodepernambuco.com.br", "www.dw.com", "veja.abril.com.br", "istoe.com.br",
  "www.cartacapital.com.br", "www.gazetadopovo.com.br", "revistaoeste.com", "jovempan.com.br", "www.oantagonista.com.br",
  "www.brasildefato.com.br", "jornalggn.com.br", "www.brasil247.com", "www.nexojornal.com.br", "www.intercept.com.br",
  "www.infomoney.com.br", "exame.com", "www.moneytimes.com.br", "www.seudinheiro.com", "forbes.com.br", "www.jota.info",
  "www.conjur.com.br", "www.migalhas.com.br", "www.tecmundo.com.br", "olhardigital.com.br", "tecnoblog.net", "canaltech.com.br",
  "super.abril.com.br", "www.lance.com.br", "www.espn.com.br", "www.gazetaesportiva.com", "www.omelete.com.br", "rollingstone.com.br",
  "www.drauziovarella.uol.com.br", "saude.abril.com.br",
];
const matches = NEWS.map((d) => `https://${d}/*`);
const apiOrigin = new URL(API_URL).origin + "/*";

const base = {
  manifest_version: 3,
  name: "Panorama — a mesma notícia em outros veículos",
  short_name: "Panorama",
  version: pkg.version,
  description: "Mostra a notícia que você está lendo em outros veículos e compara a cobertura: consenso, divergências e enquadramento.",
  icons: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" },
  action: { default_title: "Panorama", default_icon: { 16: "icons/16.png", 32: "icons/32.png" } },
  permissions: ["storage"],
  host_permissions: [apiOrigin],
  content_scripts: [{ matches, js: ["content.js"], run_at: "document_idle" }],
  web_accessible_resources: [{ resources: ["panel/*", "icons/*"], matches }],
};

const targets = {
  chrome: { ...base, background: { service_worker: "background.js", type: "module" } },
  firefox: {
    ...base,
    background: { scripts: ["background.js"], type: "module" },
    browser_specific_settings: {
      gecko: {
        id: "panorama@ronanrodrigues",
        strict_min_version: "140.0",
        // a extensão envia ao nosso serviço a URL e o texto da matéria aberta (conteúdo público)
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
console.log(`Panorama ${pkg.version} -> dist/chrome, dist/firefox (API ${API_URL})`);
