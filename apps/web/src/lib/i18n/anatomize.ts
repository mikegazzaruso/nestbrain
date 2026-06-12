// Anatomize module surface dictionary — EN is the master shape; other
// languages must mirror its keys exactly. The module implementation lives in
// the private overlay; only its UI strings are public.

const en = {
  insights: {
    title: "Insights",
    subtitle: "Business document intelligence — powered by the Anatomize module.",
    statDocs: "Business documents",
    statTables: "Data tables",
    statRows: "Data rows",
    statLast: "Last ingested",
    docsTitle: "Business documents",
    docsEmptyTitle: "No business documents yet",
    docsEmptyBody:
      "Ingest spreadsheets, Word documents, CSV exports or business PDFs — Anatomize extracts their structure and prepares them for assessment.",
    docsEmptyCta: "Ingest a document →",
    tables: (n: number) => (n === 1 ? "1 table" : `${n} tables`),
    rows: (n: number) => (n === 1 ? "1 row" : `${n.toLocaleString()} rows`),
    textOnly: "text document",
    assessTitle: "Financial assessment",
    assessTeaser:
      "The assessment engine reads your structured extracts, compares them with the previous period and surfaces friction points, recommendations and trends — calibrated to your company profile.",
    assessSoon: "Arriving in the next phase of this module",
    refresh: "Refresh",
    loadFailed: "Could not load the documents list.",
  },
};

const it: typeof en = {
  insights: {
    title: "Insights",
    subtitle: "Business document intelligence — dal modulo Anatomize.",
    statDocs: "Documenti aziendali",
    statTables: "Tabelle dati",
    statRows: "Righe dati",
    statLast: "Ultimo ingest",
    docsTitle: "Documenti aziendali",
    docsEmptyTitle: "Nessun documento aziendale",
    docsEmptyBody:
      "Ingerisci fogli di calcolo, documenti Word, export CSV o PDF aziendali — Anatomize ne estrae la struttura e li prepara per l'assessment.",
    docsEmptyCta: "Ingerisci un documento →",
    tables: (n: number) => (n === 1 ? "1 tabella" : `${n} tabelle`),
    rows: (n: number) => (n === 1 ? "1 riga" : `${n.toLocaleString()} righe`),
    textOnly: "documento testuale",
    assessTitle: "Assessment finanziario",
    assessTeaser:
      "Il motore di assessment legge gli estratti strutturati, li confronta col periodo precedente e fa emergere punti di frizione, raccomandazioni e trend — calibrati sul profilo della tua azienda.",
    assessSoon: "In arrivo nella prossima fase di questo modulo",
    refresh: "Aggiorna",
    loadFailed: "Impossibile caricare l'elenco documenti.",
  },
};

const fr: typeof en = {
  insights: {
    title: "Insights",
    subtitle: "Business document intelligence — par le module Anatomize.",
    statDocs: "Documents d'entreprise",
    statTables: "Tables de données",
    statRows: "Lignes de données",
    statLast: "Dernière ingestion",
    docsTitle: "Documents d'entreprise",
    docsEmptyTitle: "Aucun document d'entreprise",
    docsEmptyBody:
      "Ingérez des feuilles de calcul, des documents Word, des exports CSV ou des PDF d'entreprise — Anatomize en extrait la structure et les prépare pour l'évaluation.",
    docsEmptyCta: "Ingérer un document →",
    tables: (n: number) => (n === 1 ? "1 table" : `${n} tables`),
    rows: (n: number) => (n === 1 ? "1 ligne" : `${n.toLocaleString()} lignes`),
    textOnly: "document textuel",
    assessTitle: "Évaluation financière",
    assessTeaser:
      "Le moteur d'évaluation lit vos extraits structurés, les compare à la période précédente et fait ressortir points de friction, recommandations et tendances — calibrés sur le profil de votre entreprise.",
    assessSoon: "Bientôt dans la prochaine phase de ce module",
    refresh: "Actualiser",
    loadFailed: "Impossible de charger la liste des documents.",
  },
};

const es: typeof en = {
  insights: {
    title: "Insights",
    subtitle: "Business document intelligence — del módulo Anatomize.",
    statDocs: "Documentos de empresa",
    statTables: "Tablas de datos",
    statRows: "Filas de datos",
    statLast: "Última ingesta",
    docsTitle: "Documentos de empresa",
    docsEmptyTitle: "Aún no hay documentos de empresa",
    docsEmptyBody:
      "Ingiere hojas de cálculo, documentos Word, exportaciones CSV o PDF de empresa — Anatomize extrae su estructura y los prepara para la evaluación.",
    docsEmptyCta: "Ingerir un documento →",
    tables: (n: number) => (n === 1 ? "1 tabla" : `${n} tablas`),
    rows: (n: number) => (n === 1 ? "1 fila" : `${n.toLocaleString()} filas`),
    textOnly: "documento de texto",
    assessTitle: "Evaluación financiera",
    assessTeaser:
      "El motor de evaluación lee tus extractos estructurados, los compara con el período anterior y saca a la luz puntos de fricción, recomendaciones y tendencias — calibrados al perfil de tu empresa.",
    assessSoon: "Llega en la próxima fase de este módulo",
    refresh: "Actualizar",
    loadFailed: "No se pudo cargar la lista de documentos.",
  },
};

export const anatomize = { en, it, fr, es };
