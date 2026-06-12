// knowledge surface dictionary — EN is the master shape; other languages must
// mirror its keys exactly.

const en = {
  review: {
    title: "Knowledge review",
    description:
      "Atoms proposed from your project commits. Accept what's worth keeping; reject the rest. Accepted atoms compile into the global wiki on the next sync.",
    refresh: "Refresh",
    minScore: "Min score:",
    pendingCount: (visible: number, total: number) => `${visible} of ${total} pending`,
    loading: "Loading…",
    emptyQueue:
      "No atoms in the queue. Commit something in a registered project to see atoms appear here.",
    emptyFiltered: "Nothing meets the current min-score filter.",
    atomTitlePlaceholder: "Atom title",
    scoreBadge: (score: number) => `score ${score}`,
    save: "Save",
    cancel: "Cancel",
    accept: "Accept",
    acceptTitle: "Accept (lands in raw/projects/<name>/)",
    editTitle: "Edit before accepting",
    rejectTitle: "Reject (kept in knowledge-rejected/)",
    bodyLabel: "Body",
    tagsLabel: "Tags (comma-separated)",
    scoreLabel: "Score",
    loadFailed: "Failed to load pending atoms",
    saveFailed: "Save failed",
    actionFailed: (action: "accept" | "reject"): string =>
      action === "accept" ? "Accept failed" : "Reject failed",
  },
  health: {
    title: "Wiki Health",
    run: "Run Health Check",
    analyzing: "Analyzing...",
    emptyPrompt: "Run a health check to analyze your wiki",
    statArticles: "Articles",
    statOrphans: "Orphans",
    statBrokenLinks: "Broken Links",
    statSuggested: "Suggested",
    healthScore: "Health Score",
    scoreExcellent: "Excellent",
    scoreNeedsAttention: "Needs Attention",
    scoreGood: "Good",
    scoreGreat: "Great",
    findings: (count: number) => `Findings (${count})`,
    healthy: "Your wiki is healthy!",
    noIssues: "No issues found.",
    generatedAt: (date: string) =>
      `Report generated ${date} · Saved to wiki/outputs/health-report.md`,
  },
};

const it: typeof en = {
  review: {
    title: "Revisione della knowledge",
    description:
      "Atomi proposti dai commit dei tuoi progetti. Accetta ciò che vale la pena tenere; rifiuta il resto. Gli atomi accettati vengono compilati nella wiki globale alla prossima sincronizzazione.",
    refresh: "Aggiorna",
    minScore: "Punteggio minimo:",
    pendingCount: (visible: number, total: number) => `${visible} di ${total} in attesa`,
    loading: "Caricamento…",
    emptyQueue:
      "Nessun atomo in coda. Fai un commit in un progetto registrato per vedere comparire gli atomi qui.",
    emptyFiltered: "Nessun atomo supera il filtro del punteggio minimo.",
    atomTitlePlaceholder: "Titolo dell'atomo",
    scoreBadge: (score: number) => `punteggio ${score}`,
    save: "Salva",
    cancel: "Annulla",
    accept: "Accetta",
    acceptTitle: "Accetta (finisce in raw/projects/<nome>/)",
    editTitle: "Modifica prima di accettare",
    rejectTitle: "Rifiuta (conservato in knowledge-rejected/)",
    bodyLabel: "Corpo",
    tagsLabel: "Tag (separati da virgola)",
    scoreLabel: "Punteggio",
    loadFailed: "Caricamento degli atomi in attesa non riuscito",
    saveFailed: "Salvataggio non riuscito",
    actionFailed: (action: "accept" | "reject") =>
      action === "accept" ? "Accettazione non riuscita" : "Rifiuto non riuscito",
  },
  health: {
    title: "Salute della Wiki",
    run: "Esegui controllo di salute",
    analyzing: "Analisi in corso...",
    emptyPrompt: "Esegui un controllo di salute per analizzare la tua wiki",
    statArticles: "Articoli",
    statOrphans: "Orfani",
    statBrokenLinks: "Link rotti",
    statSuggested: "Suggeriti",
    healthScore: "Punteggio di salute",
    scoreExcellent: "Eccellente",
    scoreNeedsAttention: "Richiede attenzione",
    scoreGood: "Buono",
    scoreGreat: "Ottimo",
    findings: (count: number) => `Segnalazioni (${count})`,
    healthy: "La tua wiki è in salute!",
    noIssues: "Nessun problema trovato.",
    generatedAt: (date: string) =>
      `Report generato il ${date} · Salvato in wiki/outputs/health-report.md`,
  },
};

const fr: typeof en = {
  review: {
    title: "Revue des connaissances",
    description:
      "Atomes proposés à partir des commits de vos projets. Acceptez ce qui mérite d'être conservé ; rejetez le reste. Les atomes acceptés sont compilés dans le wiki global à la prochaine synchronisation.",
    refresh: "Actualiser",
    minScore: "Score minimum :",
    pendingCount: (visible: number, total: number) => `${visible} sur ${total} en attente`,
    loading: "Chargement…",
    emptyQueue:
      "Aucun atome en file d'attente. Faites un commit dans un projet enregistré pour voir apparaître des atomes ici.",
    emptyFiltered: "Aucun atome ne passe le filtre de score minimum.",
    atomTitlePlaceholder: "Titre de l'atome",
    scoreBadge: (score: number) => `score ${score}`,
    save: "Enregistrer",
    cancel: "Annuler",
    accept: "Accepter",
    acceptTitle: "Accepter (placé dans raw/projects/<nom>/)",
    editTitle: "Modifier avant d'accepter",
    rejectTitle: "Rejeter (conservé dans knowledge-rejected/)",
    bodyLabel: "Corps",
    tagsLabel: "Tags (séparés par des virgules)",
    scoreLabel: "Score",
    loadFailed: "Échec du chargement des atomes en attente",
    saveFailed: "Échec de l'enregistrement",
    actionFailed: (action: "accept" | "reject") =>
      action === "accept" ? "Échec de l'acceptation" : "Échec du rejet",
  },
  health: {
    title: "Santé du Wiki",
    run: "Lancer le contrôle de santé",
    analyzing: "Analyse en cours...",
    emptyPrompt: "Lancez un contrôle de santé pour analyser votre wiki",
    statArticles: "Articles",
    statOrphans: "Orphelins",
    statBrokenLinks: "Liens cassés",
    statSuggested: "Suggérés",
    healthScore: "Score de santé",
    scoreExcellent: "Excellent",
    scoreNeedsAttention: "Attention requise",
    scoreGood: "Bon",
    scoreGreat: "Très bon",
    findings: (count: number) => `Constats (${count})`,
    healthy: "Votre wiki est en bonne santé !",
    noIssues: "Aucun problème détecté.",
    generatedAt: (date: string) =>
      `Rapport généré le ${date} · Enregistré dans wiki/outputs/health-report.md`,
  },
};

const es: typeof en = {
  review: {
    title: "Revisión de conocimiento",
    description:
      "Átomos propuestos a partir de los commits de tus proyectos. Acepta lo que valga la pena conservar; rechaza el resto. Los átomos aceptados se compilan en la wiki global en la próxima sincronización.",
    refresh: "Actualizar",
    minScore: "Puntuación mínima:",
    pendingCount: (visible: number, total: number) => `${visible} de ${total} pendientes`,
    loading: "Cargando…",
    emptyQueue:
      "No hay átomos en la cola. Haz un commit en un proyecto registrado para ver átomos aquí.",
    emptyFiltered: "Ningún átomo supera el filtro de puntuación mínima.",
    atomTitlePlaceholder: "Título del átomo",
    scoreBadge: (score: number) => `puntuación ${score}`,
    save: "Guardar",
    cancel: "Cancelar",
    accept: "Aceptar",
    acceptTitle: "Aceptar (se guarda en raw/projects/<nombre>/)",
    editTitle: "Editar antes de aceptar",
    rejectTitle: "Rechazar (se conserva en knowledge-rejected/)",
    bodyLabel: "Cuerpo",
    tagsLabel: "Etiquetas (separadas por comas)",
    scoreLabel: "Puntuación",
    loadFailed: "No se pudieron cargar los átomos pendientes",
    saveFailed: "Error al guardar",
    actionFailed: (action: "accept" | "reject") =>
      action === "accept" ? "Error al aceptar" : "Error al rechazar",
  },
  health: {
    title: "Salud de la Wiki",
    run: "Ejecutar chequeo de salud",
    analyzing: "Analizando...",
    emptyPrompt: "Ejecuta un chequeo de salud para analizar tu wiki",
    statArticles: "Artículos",
    statOrphans: "Huérfanos",
    statBrokenLinks: "Enlaces rotos",
    statSuggested: "Sugeridos",
    healthScore: "Puntuación de salud",
    scoreExcellent: "Excelente",
    scoreNeedsAttention: "Necesita atención",
    scoreGood: "Bueno",
    scoreGreat: "Muy bueno",
    findings: (count: number) => `Hallazgos (${count})`,
    healthy: "¡Tu wiki está sana!",
    noIssues: "No se encontraron problemas.",
    generatedAt: (date: string) =>
      `Informe generado el ${date} · Guardado en wiki/outputs/health-report.md`,
  },
};

export const knowledge = { en, it, fr, es };
