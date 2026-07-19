import type { McpLocale } from "./mcpLocale";

/**
 * Three-part tool descriptions (function / Use when / Do NOT).
 *
 * Design (TEAM_MODE.md §Q2):
 * - Body is English-only — agent models recognize intent from English
 *   instruction text regardless of the user's query language.
 * - Example queries inside `{examples}` are localized per {@link McpLocale};
 *   English is always present, the active locale's examples are appended
 *   when it is not `en`.
 *
 * The `{examples}` placeholder is filled by {@link resolveToolDescription}.
 * Tool ids here must match the names passed to `server.tool(...)` in
 * `index.ts`.
 */
export const TOOL_DESCRIPTIONS = {
  list_projects:
    "List projects that have been analyzed by the Agent Mind Map extension. Use when the user mentions a project and you need a `projectSlug` to call other tools, or when orienting on what past work exists. Examples: {examples}\nDo NOT use for searching session content — call `search_project_history` or `retrieve_project_memory` instead.",
  get_project_briefing:
    "Summarize recent sessions and key concepts of one project. Use when the user asks 'what have we been working on' or wants a high-level recap of a project. Examples: {examples}\nDo NOT use for targeted queries about a specific topic — call `search_project_history` for that.",
  list_project_sessions:
    "List analyzed sessions for a project, paged by recency. Virtual sessions (incremental analysis fragments of a long session) are hidden by default; pass includeVirtual=true to see them. Use when the user wants to browse session history or pick a specific `sessionId`. Examples: {examples}\nDo NOT use for content search — call `search_project_history`.",
  search_project_history:
    "Search past session history by query (semantic + keyword matching across outlines, concepts, evidence, and code references). Use when the user asks about past work, decisions, or debugging in a project — the primary tool for 'what did we do about X' / 'did we ever solve Y' questions. Examples: {examples}\nDo NOT use for current-file questions or live code lookup — this server indexes past AI agent sessions only.",
  retrieve_project_memory:
    "Retrieve condensed memory for a query — a synthesized evidence-first briefing, not a raw session list. Use when the user asks 'remind me what we decided about X' or wants a compact recall of past decisions. Examples: {examples}\nDo NOT use when the user wants to browse sessions — call `list_project_sessions` or `search_project_history`.",
  get_concept_detail:
    "Show detail for a specific concept key (definition, aliases, evidence across sessions). Use when another tool returned a `conceptKey` and the user wants to drill in. Examples: {examples}\nDo NOT use without a `conceptKey` — call `search_project_history` first to discover one.",
  get_session_outline:
    "Render one session's outline as markdown (title, summary, topics, code refs). Use when you have a `sessionId` and the user wants the structure of that session. Examples: {examples}\nDo NOT use without a `sessionId` — call `list_project_sessions` or `search_project_history` first.",
} as const;

export type ToolId = keyof typeof TOOL_DESCRIPTIONS;

/**
 * Per-locale example queries for each tool. English is the base; other
 * locales add their own examples. Missing tool × locale combos fall back
 * to English-only (via {@link resolveToolDescription}).
 */
export const TOOL_EXAMPLES: Record<ToolId, Partial<Record<McpLocale, string[]>>> = {
  list_projects: {
    en: ['"what projects have I analyzed?"', '"show me my agent mind map projects"'],
    "zh-cn": ['"我分析过哪些项目"', '"看看 agent mind map 里有哪些项目"'],
    ja: ['"分析したプロジェクト一覧"', '"マインドマップのプロジェクトを教えて"'],
    ko: ['"분석한 프로젝트 목록"', '"마인드맵 프로젝트 보여줘"'],
    "pt-br": ['"quais projetos analisei?"', '"mostrar projetos do agent mind map"'],
    es: ['"¿qué proyectos he analizado?"', '"muéstrame los proyectos del mind map"'],
    de: ['"welche Projekte habe ich analysiert?"', '"zeige meine Mind-Map-Projekte"'],
    fr: ['"quels projets ai-je analysés ?"', '"montre les projets du mind map"'],
    hi: ['"मैंने कौन से प्रोजेक्ट एनालाइज़ किए?"', '"माइंड मैप प्रोजेक्ट दिखाओ"'],
    id: ['"proyek apa saja yang sudah dianalisis?"', '"tampilkan proyek agent mind map"'],
  },
  get_project_briefing: {
    en: ['"what have we been working on in this project?"', '"give me a recap of project X"'],
    "zh-cn": ['"这个项目我们最近在做什么"', '"总结一下项目 X"'],
    ja: ['"このプロジェクトで最近何をやった?"', '"プロジェクト X の要約を"'],
    ko: ['"이 프로젝트에서 최근 뭘 했어?"', '"프로젝트 X 요약해줘"'],
    "pt-br": ['"o que temos feito neste projeto?"', '"me dê um resumo do projeto X"'],
    es: ['"¿en qué hemos trabajado en este proyecto?"', '"dame un resumen del proyecto X"'],
    de: ['"woran haben wir in diesem Projekt gearbeitet?"', '"gib mir ein Recap von Projekt X"'],
    fr: ['"sur quoi avons-nous travaillé dans ce projet ?"', '"récap du projet X"'],
    hi: ['"इस प्रोजेक्ट में हम क्या कर रहे थे?"', '"प्रोजेक्ट X का सारांश दो"'],
    id: ['"apa yang sedang kita kerjakan di proyek ini?"', '"ringkasan proyek X"'],
  },
  list_project_sessions: {
    en: ['"show recent sessions for project X"', '"list sessions in project X"'],
    "zh-cn": ['"看看项目 X 最近的 session"', '"列出项目 X 的会话"'],
    ja: ['"プロジェクト X の最近のセッションを"', '"セッション一覧を"'],
    ko: ['"프로젝트 X 최근 세션 보여줘"', '"세션 목록"'],
    "pt-br": ['"sessões recentes do projeto X"', '"listar sessões do projeto X"'],
    es: ['"sesiones recientes del proyecto X"', '"lista de sesiones del proyecto X"'],
    de: ['"letzte Sitzungen von Projekt X"', '"Sitzungen von Projekt X auflisten"'],
    fr: ['"sessions récentes du projet X"', '"lister les sessions du projet X"'],
    hi: ['"प्रोजेक्ट X की हाल की सत्र"', '"सत्र सूची"'],
    id: ['"sesi terbaru proyek X"', '"daftar sesi proyek X"'],
  },
  search_project_history: {
    en: ['"did we ever fix the 401 on refresh?"', '"how did we handle clock skew last time?"'],
    "zh-cn": ['"我们之前怎么处理 clock skew 的"', '"上次改 auth 是哪次 session"'],
    ja: ['"前に clock skew をどう直したっけ?"', '"auth を直したセッションは?"'],
    ko: ['"지난번에 clock skew 어떻게 처리했지?"', '"auth 고쳤던 세션 찾아줘"'],
    "pt-br": [
      '"a gente já resolveu o 401 no refresh?"',
      '"como lidamos com clock skew da última vez?"',
    ],
    es: [
      '"¿arreglamos alguna vez el 401 al refrescar?"',
      '"¿cómo manejamos clock skew la última vez?"',
    ],
    de: [
      '"hatten wir das 401 beim Refresh schon mal behoben?"',
      '"wie haben wir clock skew letzte Mal gelöst?"',
    ],
    fr: [
      '"est-ce qu’on a déjà corrigé le 401 sur le refresh ?"',
      '"comment a-t-on géré clock skew la dernière fois ?"',
    ],
    hi: ['"क्या हमने refresh पर 401 ठीक किया था?"', '"पिछली बार clock skew को कैसे संभाला?"'],
    id: [
      '"pernahkah kita memperbaiki 401 saat refresh?"',
      '"bagaimana kita menangani clock skew terakhir kali?"',
    ],
  },
  retrieve_project_memory: {
    en: ['"remind me what we decided about the auth retry"', '"what was our conclusion on X?"'],
    "zh-cn": ['"提醒一下我们对 auth 重试的决定"', '"关于 X 我们的结论是什么"'],
    ja: ['"auth リトライの結論を思い出して"', '"X についてどう決めたっけ"'],
    ko: ['"auth 재시도 결정 알려줘"', '"X에 대해 우리가 내린 결론은?"'],
    "pt-br": [
      '"lembre o que decidimos sobre o retry de auth"',
      '"qual foi nossa conclusão sobre X?"',
    ],
    es: [
      '"recuérdame qué decidimos sobre el retry de auth"',
      '"¿cuál fue nuestra conclusión sobre X?"',
    ],
    de: [
      '"erinnere mich an unsere Entscheidung zum auth-retry"',
      '"was war unsere Schlussfolgerung zu X?"',
    ],
    fr: [
      '"rappelle-moi ce qu’on a décidé pour le retry d’auth"',
      '"quelle était notre conclusion sur X ?"',
    ],
    hi: ['"हमें याद दिलाओ auth retry पर क्या तय किया था"', '"X पर हमारा निष्कर्ष क्या था?"'],
    id: ['"ingatkan saya keputusan kita tentang retry auth"', '"apa kesimpulan kita tentang X?"'],
  },
  get_concept_detail: {
    en: ['"tell me more about the auth concept"', '"what evidence is linked to conceptKey=auth?"'],
    "zh-cn": ['"详细说说 auth 这个概念"', '"conceptKey=auth 有哪些证据"'],
    ja: ['"auth コンセプトについて詳しく"', '"conceptKey=auth の証拠は?"'],
    ko: ['"auth 컨셉 자세히 설명해줘"', '"conceptKey=auth의 증거는?"'],
    "pt-br": ['"me diga mais sobre o conceito auth"', '"quais evidências para conceptKey=auth?"'],
    es: ['"cuéntame más sobre el concepto auth"', '"¿qué evidencia hay para conceptKey=auth?"'],
    de: [
      '"erzähl mir mehr über das auth-Konzept"',
      '"welche Evidence gibt es für conceptKey=auth?"',
    ],
    fr: ['"dis-m’en plus sur le concept auth"', '"quelle preuve pour conceptKey=auth ?"'],
    hi: ['"auth कॉन्सेप्ट के बारे में और बताओ"', '"conceptKey=auth के लिए कौन सा साक्ष्य है?"'],
    id: ['"ceritakan lebih tentang konsep auth"', '"apa bukti untuk conceptKey=auth?"'],
  },
  get_session_outline: {
    en: ['"show me the outline of session abc123"', '"what topics did session abc123 cover?"'],
    "zh-cn": ['"显示 session abc123 的大纲"', '"session abc123 聊了哪些主题"'],
    ja: ['"セッション abc123 のアウトラインを"', '"セッション abc123 は何を話した?"'],
    ko: ['"세션 abc123 아웃라인 보여줘"', '"세션 abc123이 다룬 토픽은?"'],
    "pt-br": ['"mostre o outline da sessão abc123"', '"quais tópicos a sessão abc123 cobriu?"'],
    es: ['"muestra el outline de la sesión abc123"', '"¿qué temas cubrió la sesión abc123?"'],
    de: ['"zeige den Outline der Sitzung abc123"', '"welche Topics hatte Sitzung abc123?"'],
    fr: [
      '"montre le outline de la session abc123"',
      '"quels sujets la session abc123 a couverts ?"',
    ],
    hi: ['"सत्र abc123 का आउटलाइन दिखाओ"', '"सत्र abc123 ने कौन से विषय छुए?"'],
    id: ['"tampilkan outline sesi abc123"', '"topik apa saja di sesi abc123?"'],
  },
};

/** Render a tool description with localized examples inlined. */
export function resolveToolDescription(toolId: ToolId, locale: McpLocale): string {
  const template = TOOL_DESCRIPTIONS[toolId];
  const en = TOOL_EXAMPLES[toolId].en ?? [];
  const parts: string[] = en.map((e) => `EN ${e}`);
  if (locale !== "en") {
    const tag = locale.toUpperCase();
    const localized = TOOL_EXAMPLES[toolId][locale] ?? [];
    for (const e of localized) {
      parts.push(`${tag} ${e}`);
    }
  }
  return template.replace("{examples}", parts.join(" / "));
}

/** Convenience: render descriptions for all tools in one call. */
export function resolveAllToolDescriptions(locale: McpLocale): Record<ToolId, string> {
  const out = {} as Record<ToolId, string>;
  for (const id of Object.keys(TOOL_DESCRIPTIONS) as ToolId[]) {
    out[id] = resolveToolDescription(id, locale);
  }
  return out;
}
