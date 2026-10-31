/**
 * Análise de cobertura: a mesma notícia em vários veículos. A IA compara; o código confere as evidências
 * (trecho citado precisa existir no texto daquele veículo, senão é descartado).
 * Avalia cada MATÉRIA pelo texto, não rotula veículos com ideologia fixa.
 */
export const NEWS_SYSTEM = `Você é um editor de checagem que compara a cobertura da MESMA notícia por veículos brasileiros.
Recebe a matéria ORIGINAL (a que o leitor está lendo) e outras coberturas numeradas (algumas só com manchete).

Regras:
- Use somente o que está nos textos. Não traga fatos externos nem opinião própria.
- Avalie cada matéria pelo texto dela (tom, palavras escolhidas, quem é ouvido, o que destaca e o que omite).
  Não atribua ideologia fixa a veículos.
- "evidence" deve ser um trecho LITERAL, copiado do texto daquele veículo (até 160 caracteres). Sem trecho, use null.
- Divergências: só diferenças reais (números, versões dos fatos, causas atribuídas, interpretação), não estilo.
  Em cada divergência liste apenas os veículos que AFIRMAM algo sobre o tópico; "não menciona" não é posição
  (omissões vão em "emphasis"/"missing"). No máximo 4 divergências, as mais importantes.
- Se uma cobertura não for sobre o mesmo acontecimento, marque sameStory=false para ela.
- Português do Brasil, frases curtas e neutras.`;

const SOURCE = {
  type: "object",
  required: ["ref", "sameStory", "tone", "framing", "emphasis", "voices", "loadedWords", "evidence"],
  properties: {
    ref: { type: "integer", description: "0 = original; 1..n = coberturas" },
    sameStory: { type: "boolean" },
    tone: { type: "string", enum: ["neutro", "informativo", "critico", "favoravel", "alarmista", "opinativo", "sensacionalista"] },
    framing: { type: "string", description: "como esta matéria enquadra a história, 1 frase" },
    emphasis: { type: "string", description: "o que ela destaca que as outras não destacam" },
    voices: { type: "array", items: { type: "string" }, description: "quem é ouvido/citado (ex.: governo, oposição, especialista, empresa)" },
    loadedWords: { type: "array", items: { type: "string" }, description: "palavras carregadas usadas (vazio se nenhuma)" },
    evidence: { type: "string" },
  },
};

export const NEWS_SCHEMA = {
  type: "object",
  required: ["summary", "consensus", "divergences", "sources", "missing", "balance"],
  properties: {
    summary: { type: "string", description: "o acontecimento em 2 frases neutras" },
    consensus: { type: "array", items: { type: "string" }, description: "fatos em que todas as coberturas concordam" },
    divergences: {
      type: "array",
      items: {
        type: "object",
        required: ["topic", "positions"],
        properties: {
          topic: { type: "string" },
          positions: { type: "array", items: { type: "object", required: ["ref", "says"], properties: { ref: { type: "integer" }, says: { type: "string" } } } },
        },
      },
    },
    sources: { type: "array", items: SOURCE },
    missing: { type: "array", items: { type: "string" }, description: "perguntas importantes que nenhuma cobertura respondeu" },
    balance: { type: "string", description: "como a cobertura do conjunto se distribui (ex.: maioria ouve só o governo), 1 frase" },
  },
};

export type NewsTone = "neutro" | "informativo" | "critico" | "favoravel" | "alarmista" | "opinativo" | "sensacionalista";
export interface NewsAnalysisRaw {
  summary: string;
  consensus: string[];
  divergences: { topic: string; positions: { ref: number; says: string }[] }[];
  sources: { ref: number; sameStory: boolean; tone: NewsTone; framing: string; emphasis: string; voices: string[]; loadedWords: string[]; evidence: string | null }[];
  missing: string[];
  balance: string;
}

/** Classifica a página aberta e gera a melhor busca para achar o MESMO conteúdo em outras fontes. */
export const CLASSIFY_SYSTEM = `Classifique a página que o leitor está vendo e gere a busca para achar o MESMO conteúdo em outras fontes.
- kind: news (notícia/reportagem), product (página de produto à venda), recipe (receita), video, article (artigo, tutorial, guia), other.
- niche: o assunto principal.
- query: 4 a 8 palavras com os termos que identificam ESTE acontecimento/conteúdo (nomes próprios, números, local), sem o nome do veículo.
- entities: pessoas, órgãos, empresas e lugares centrais.`;

export const NICHES = ["geral", "politica", "economia", "esportes", "tecnologia", "entretenimento", "saude", "ciencia", "mundo", "regional", "juridico"] as const;

export const CLASSIFY_SCHEMA = {
  type: "object",
  required: ["kind", "niche", "query", "entities"],
  properties: {
    kind: { type: "string", enum: ["news", "product", "recipe", "video", "article", "other"] },
    niche: { type: "string", enum: [...NICHES] },
    query: { type: "string" },
    entities: { type: "array", items: { type: "string" } },
  },
};

export interface PageClass { kind: "news" | "product" | "recipe" | "video" | "article" | "other"; niche: (typeof NICHES)[number]; query: string; entities: string[] }
