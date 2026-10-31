-- Registro de fontes por tipo/nicho com peso de relevância (0..1). O ranking das coberturas usa
-- semelhança do título + peso + bônus quando o nicho da fonte bate com o da página (classificado pela IA).
-- Fonte fora da lista entra com peso baixo (só completa a lista).
CREATE TABLE content_sources (
  domain   text PRIMARY KEY,
  site     text NOT NULL,
  kind     text NOT NULL DEFAULT 'news',          -- news | product | recipe | video | article
  niches   text[] NOT NULL DEFAULT '{geral}',     -- geral, politica, economia, esportes, tecnologia, entretenimento, saude, ciencia, mundo, regional, juridico
  weight   real NOT NULL DEFAULT 0.5
);

ALTER TABLE news_lookups ADD COLUMN kind text, ADD COLUMN niche text;

INSERT INTO content_sources (domain, site, niches, weight) VALUES
  -- grandes portais e jornais nacionais
  ('g1.globo.com', 'g1', '{geral,politica,economia,regional}', 1.0),
  ('www1.folha.uol.com.br', 'Folha', '{geral,politica,economia,mundo}', 1.0),
  ('www.estadao.com.br', 'Estadão', '{geral,politica,economia}', 1.0),
  ('oglobo.globo.com', 'O Globo', '{geral,politica,economia}', 1.0),
  ('www.cnnbrasil.com.br', 'CNN Brasil', '{geral,politica,economia,mundo}', 0.95),
  ('noticias.uol.com.br', 'UOL', '{geral,politica}', 0.9),
  ('www.bbc.com', 'BBC News Brasil', '{geral,mundo,ciencia}', 0.95),
  ('agenciabrasil.ebc.com.br', 'Agência Brasil', '{geral,politica,economia}', 0.9),
  ('www.metropoles.com', 'Metrópoles', '{geral,politica,entretenimento}', 0.8),
  ('www.poder360.com.br', 'Poder360', '{politica,economia}', 0.85),
  ('noticias.r7.com', 'R7', '{geral}', 0.7),
  ('www.terra.com.br', 'Terra', '{geral,entretenimento}', 0.65),
  ('sbtnews.sbt.com.br', 'SBT News', '{geral}', 0.7),
  ('www.band.uol.com.br', 'Band', '{geral}', 0.7),
  ('www.correiobraziliense.com.br', 'Correio Braziliense', '{geral,politica}', 0.8),
  ('www.em.com.br', 'Estado de Minas', '{geral,regional}', 0.75),
  ('gauchazh.clicrbs.com.br', 'GZH', '{geral,regional}', 0.75),
  ('www.otempo.com.br', 'O Tempo', '{geral,regional}', 0.65),
  ('www.opovo.com.br', 'O Povo', '{geral,regional}', 0.65),
  ('www.diariodepernambuco.com.br', 'Diario de Pernambuco', '{geral,regional}', 0.6),
  ('www.dw.com', 'DW Brasil', '{mundo,geral}', 0.8),
  -- revistas e análise (linhas editoriais variadas: a comparação de enquadramento depende disso)
  ('veja.abril.com.br', 'Veja', '{politica,geral}', 0.8),
  ('istoe.com.br', 'IstoÉ', '{politica,geral}', 0.6),
  ('www.cartacapital.com.br', 'CartaCapital', '{politica}', 0.7),
  ('www.gazetadopovo.com.br', 'Gazeta do Povo', '{politica,geral}', 0.75),
  ('revistaoeste.com', 'Revista Oeste', '{politica}', 0.6),
  ('jovempan.com.br', 'Jovem Pan', '{politica,geral}', 0.65),
  ('www.oantagonista.com.br', 'O Antagonista', '{politica}', 0.6),
  ('www.brasildefato.com.br', 'Brasil de Fato', '{politica}', 0.6),
  ('jornalggn.com.br', 'Jornal GGN', '{politica}', 0.5),
  ('www.brasil247.com', 'Brasil 247', '{politica}', 0.5),
  ('www.nexojornal.com.br', 'Nexo', '{politica,ciencia,geral}', 0.75),
  ('piaui.folha.uol.com.br', 'piauí', '{politica}', 0.75),
  ('www.intercept.com.br', 'Intercept Brasil', '{politica}', 0.6),
  -- economia e negócios
  ('valor.globo.com', 'Valor', '{economia}', 1.0),
  ('www.infomoney.com.br', 'InfoMoney', '{economia}', 0.9),
  ('exame.com', 'Exame', '{economia,tecnologia}', 0.85),
  ('www.moneytimes.com.br', 'Money Times', '{economia}', 0.7),
  ('www.seudinheiro.com', 'Seu Dinheiro', '{economia}', 0.65),
  ('forbes.com.br', 'Forbes Brasil', '{economia}', 0.7),
  ('www.estadao.com.br/economia', 'Estadão Economia', '{economia}', 0.9),
  -- jurídico
  ('www.jota.info', 'JOTA', '{juridico,politica}', 0.85),
  ('www.conjur.com.br', 'ConJur', '{juridico}', 0.8),
  ('www.migalhas.com.br', 'Migalhas', '{juridico}', 0.75),
  -- tecnologia e ciência
  ('www.tecmundo.com.br', 'TecMundo', '{tecnologia}', 0.85),
  ('olhardigital.com.br', 'Olhar Digital', '{tecnologia,ciencia}', 0.8),
  ('tecnoblog.net', 'Tecnoblog', '{tecnologia}', 0.85),
  ('canaltech.com.br', 'Canaltech', '{tecnologia}', 0.8),
  ('www.uol.com.br/tilt', 'Tilt UOL', '{tecnologia}', 0.75),
  ('revistagalileu.globo.com', 'Galileu', '{ciencia}', 0.75),
  ('super.abril.com.br', 'Superinteressante', '{ciencia}', 0.7),
  -- esportes
  ('ge.globo.com', 'ge', '{esportes}', 1.0),
  ('www.lance.com.br', 'Lance!', '{esportes}', 0.85),
  ('www.espn.com.br', 'ESPN Brasil', '{esportes}', 0.9),
  ('www.uol.com.br/esporte', 'UOL Esporte', '{esportes}', 0.8),
  ('www.gazetaesportiva.com', 'Gazeta Esportiva', '{esportes}', 0.7),
  -- entretenimento
  ('gshow.globo.com', 'Gshow', '{entretenimento}', 0.8),
  ('www.omelete.com.br', 'Omelete', '{entretenimento}', 0.8),
  ('rollingstone.com.br', 'Rolling Stone Brasil', '{entretenimento}', 0.7),
  ('www.purepeople.com.br', 'Purepeople', '{entretenimento}', 0.5),
  -- saúde
  ('www.drauziovarella.uol.com.br', 'Drauzio Varella', '{saude}', 0.85),
  ('saude.abril.com.br', 'Veja Saúde', '{saude}', 0.75)
ON CONFLICT DO NOTHING;
