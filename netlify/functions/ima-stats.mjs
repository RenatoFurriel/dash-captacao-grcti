/**
 * Netlify Function — contagens ao vivo do funil "MKT IMA CLAUDE" (Data Crazy).
 *
 * Lê quantas pessoas realizaram o CHECKIN e quantas ENTRARAM NO ZOOM,
 * direto da API do CRM, mantendo o token secreto no servidor (env var).
 *
 * Os números são CUMULATIVOS no funil: como os cards avançam de etapa,
 * "fez checkin" soma todas as etapas a partir de CHECKIN REALIZADO, e
 * "entrou no zoom" soma a partir de ENTROU NO ZOOM. Assim os contadores
 * não caem quando um lead avança para a etapa seguinte.
 *
 * Variável de ambiente necessária (configurar no painel da Netlify):
 *   DATACRAZY_API_TOKEN   — JWT da API do Data Crazy
 *   DATACRAZY_API_BASE_URL (opcional, default https://crm.g1.datacrazy.io)
 */

const BASE_URL = (process.env.DATACRAZY_API_BASE_URL || "https://crm.g1.datacrazy.io").replace(/\/+$/, "");
const TOKEN = process.env.DATACRAZY_API_TOKEN || "";

const PIPELINE_ID = "cee34885-1079-41d3-9fde-55dafbda71ae"; // MKT IMA CLAUDE

// Etapas do funil (em ordem). IDs obtidos via get_pipeline_stages.
const STAGE = {
  CHECKIN_REALIZADO:      "e7d575e9-1e95-4dde-9782-b5ec24c2b8f5",
  NOTIFICADO_E_HOJE:      "847ddda8-003f-42e2-a00d-eba9c4022194",
  NOTIFICADO_COMECOU:     "3bfefc65-a0ca-4f21-bd8e-a07a6f98e426",
  ENTROU_NO_ZOOM:         "d343a0ef-a3a6-4600-9d78-cdaff512505f",
  CONCLUIU_A_IMERSAO:     "df8033c9-d82d-4399-8014-26637394dbe4",
  PARTICIPOU_PARCIAL:     "db8bb6dc-ebcd-4a41-91db-6370669a7b3d",
};

// "Fez checkin" = checkin + todas as etapas posteriores de participação.
const CHECKIN_STAGES = [
  STAGE.CHECKIN_REALIZADO,
  STAGE.NOTIFICADO_E_HOJE,
  STAGE.NOTIFICADO_COMECOU,
  STAGE.ENTROU_NO_ZOOM,
  STAGE.CONCLUIU_A_IMERSAO,
  STAGE.PARTICIPOU_PARCIAL,
];

// "Entrou no zoom" = zoom + etapas posteriores.
const ZOOM_STAGES = [
  STAGE.ENTROU_NO_ZOOM,
  STAGE.CONCLUIU_A_IMERSAO,
  STAGE.PARTICIPOU_PARCIAL,
];

async function stageCount(stageId) {
  const url = new URL(BASE_URL + "/api/crm/businesses");
  url.searchParams.set("filter[pipeline.id]", PIPELINE_ID);
  url.searchParams.set("filter[stage.id]", stageId);
  url.searchParams.set("take", "1"); // só precisamos do `count` total

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      "x-timezone": "America/Sao_Paulo",
      "x-language": "pt",
      "x-affiliate-code": "",
    },
  });
  if (!res.ok) {
    throw new Error(`Data Crazy HTTP ${res.status} (stage ${stageId})`);
  }
  const json = await res.json();
  return typeof json.count === "number" ? json.count : 0;
}

async function sumStages(stageIds) {
  const counts = await Promise.all(stageIds.map(stageCount));
  return counts.reduce((a, b) => a + b, 0);
}

export default async function handler() {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    // cache curto na CDN: evita martelar o CRM em refresh frequente
    "Cache-Control": "public, max-age=30, s-maxage=30",
  };

  if (!TOKEN) {
    return new Response(
      JSON.stringify({ error: "DATACRAZY_API_TOKEN não configurado na Netlify." }),
      { status: 500, headers }
    );
  }

  try {
    const [checkin, zoom] = await Promise.all([
      sumStages(CHECKIN_STAGES),
      sumStages(ZOOM_STAGES),
    ]);
    return new Response(
      JSON.stringify({ checkin, zoom, updatedAt: new Date().toISOString() }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err.message || err) }),
      { status: 502, headers }
    );
  }
}
