#!/usr/bin/env node
// Generate per-locale UI translation review checklists under docs/multilingual-checklist/.
//
// Usage: node scripts/generate-multilingual-checklist.mjs
//
// Re-run after bundle.l10n.json or locale bundles change to refresh EN/target pairs.
// Reviewers tick boxes in GitHub (PR comments or direct edits); REVIEW-STATUS.md
// tracks overall sign-off separately.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const L10N_DIR = join(ROOT, "extension", "l10n");
const OUT_DIR = join(ROOT, "docs", "multilingual-checklist");

const ENGLISH_FILE = "bundle.l10n.json";

/** Locales that ship UI bundles (excluding English baseline). */
const LOCALES = [
  { id: "zh-cn", label: "Simplified Chinese", native: "简体中文", reviewTier: "maintainer" },
  { id: "ja", label: "Japanese", native: "日本語", reviewTier: "community" },
  { id: "ko", label: "Korean", native: "한국어", reviewTier: "community" },
  { id: "pt-br", label: "Brazilian Portuguese", native: "Português (Brasil)", reviewTier: "community" },
  { id: "es", label: "Spanish", native: "Español", reviewTier: "community" },
  { id: "de", label: "German", native: "Deutsch", reviewTier: "community" },
  { id: "fr", label: "French", native: "Français", reviewTier: "community" },
  { id: "hi", label: "Hindi", native: "हिन्दी", reviewTier: "community" },
  { id: "id", label: "Indonesian", native: "Bahasa Indonesia", reviewTier: "community" },
];

const SECTION_LABELS = {
  "ui.progress": "Progress notifications",
  "ui.loading": "Loading states",
  "ui.command": "Commands",
  "ui.warning": "Warnings",
  "ui.download": "Download & export",
  "ui.exportJson": "JSON export",
  "ui.library": "Library messages",
  "ui.cliInstall": "CLI install guide",
  "ui.ontology": "Ontology / concept cache",
  "ui.concept": "Concept path hints",
  "ui.batch": "Batch analyze",
  "ui.codeRefs": "Code references",
  "ui.merge": "Merge scope & progress",
  "ui.search": "Search",
  "ui.browse": "Browse sessions",
  "ui.pickSession": "Pick session",
  "ui.llm": "LLM progress",
  "ui.debug": "Debug commands",
  "ui.uiSetting": "UI settings",
  "ui.jump": "Jump to transcript",
  "ui.selectModel": "Model picker",
  "mindmap.turn": "Turn view labels",
  "mindmap.concept": "Concept mind map",
  "mindmap.merge": "Merged mind map",
  "webview.loading": "Webview loading",
  "webview.menu": "Webview context menu",
  "notify.unexpected": "Unexpected errors",
};

function readBundle(file) {
  return JSON.parse(readFileSync(join(L10N_DIR, file), "utf8"));
}

function sectionId(key) {
  const parts = key.split(".");
  if (parts[0] === "notify") {
    return "notify.unexpected";
  }
  if (parts[0] === "mindmap" || parts[0] === "webview") {
    return `${parts[0]}.${parts[1]}`;
  }
  return `${parts[0]}.${parts[1]}`;
}

function groupKeys(keys) {
  const groups = new Map();
  for (const key of keys.sort()) {
    const id = sectionId(key);
    const list = groups.get(id) ?? [];
    list.push(key);
    groups.set(id, list);
  }
  return groups;
}

function escapeMd(text) {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderLocaleChecklist(locale, english, target) {
  const keys = Object.keys(english).sort();
  const groups = groupKeys(keys);
  const bundleFile = `extension/l10n/bundle.l10n.${locale.id}.json`;
  const tierNote =
    locale.reviewTier === "maintainer"
      ? "Maintainer-reviewed baseline. Re-check when English keys change."
      : "AI-assisted initial draft — needs native-speaker review.";

  const lines = [
    `# ${locale.label} (${locale.id}) — UI translation review`,
    "",
    `> Auto-generated from \`${bundleFile}\`. Regenerate with \`npm run checklist:l10n\`.`,
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Locale ID | \`${locale.id}\` |`,
    `| Native name | ${locale.native} |`,
    `| Bundle | [\`${bundleFile}\`](../../${bundleFile.replace(/\\/g, "/")}) |`,
    `| Keys | ${keys.length} |`,
    `| Review tier | ${tierNote} |`,
    "| Status | ☐ Not started · ☐ In progress · ☐ Reviewed |",
    "| Reviewer | _@github-username_ |",
    "| Review PR | _#___ |",
    "| Last updated | _YYYY-MM-DD_ |",
    "",
    "## Review criteria",
    "",
    "Tick each row when the translation:",
    "",
    "- [ ] Matches the English meaning in context (notifications, progress, errors).",
    "- [ ] Keeps placeholders `{0}`, `{1}`, … in the same order and count.",
    "- [ ] Uses consistent product terms (`Agent Mind Map`, `LLM`, `CLI`, `VS Code`).",
    "- [ ] Reads naturally for UI copy (not overly literal).",
    "",
    "---",
    "",
  ];

  for (const [groupId, groupKeys] of groups) {
    const title = SECTION_LABELS[groupId] ?? groupId;
    lines.push(`## ${title} (\`${groupId}\`, ${groupKeys.length} keys)`);
    lines.push("");
    for (const key of groupKeys) {
      const en = escapeMd(english[key] ?? "");
      const tr = escapeMd(target[key] ?? "");
      lines.push(`- [ ] **\`${key}\`**`);
      lines.push(`  - **EN:** ${en}`);
      lines.push(`  - **${locale.id.toUpperCase()}:** ${tr}`);
      lines.push("");
    }
  }

  lines.push("## Sign-off");
  lines.push("");
  lines.push("- [ ] Spot-checked in Extension Development Host with `agentMindmap.ui.locale` set to this locale.");
  lines.push("- [ ] Updated [REVIEW-STATUS.md](./REVIEW-STATUS.md) for this locale.");
  lines.push("");
  return lines.join("\n");
}

function renderReviewStatus() {
  const lines = [
    "# Multilingual review status",
    "",
    "> Track human sign-off per locale. Update this file when a locale checklist is fully reviewed.",
    "",
    "| Locale | Language | UI bundle | UI review | Mind map labels | Detection tests | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| `en` | English | baseline | n/a | n/a | n/a | Source strings in `bundle.l10n.json` |",
  ];

  for (const locale of LOCALES) {
    const uiReview = locale.reviewTier === "maintainer" ? "✅ Maintainer" : "⏳ Needs review";
    const mindmap = locale.id === "zh-cn" || ["ja", "ko"].includes(locale.id) ? "✅ Shipped" : "⏳ Needs review";
    const detection = locale.reviewTier === "maintainer" ? "✅ Covered" : "⏳ Needs review";
    const checklist = `[${locale.id}.md](./${locale.id}.md)`;
    lines.push(
      `| \`${locale.id}\` | ${locale.label} | ${checklist} | ${uiReview} | ${mindmap} | ${detection} | ${locale.native} |`
    );
  }

  lines.push("");
  lines.push("## Mind map output (conversation language)");
  lines.push("");
  lines.push("Separate from UI bundles. Review:");
  lines.push("");
  lines.push("- Structural labels: [`extension/src/mindmap/outputLanguageLabels.ts`](../../extension/src/mindmap/outputLanguageLabels.ts)");
  lines.push("- Detection heuristics: [`extension/src/llm/promptLanguage.ts`](../../extension/src/llm/promptLanguage.ts)");
  lines.push("- Tests: [`test/promptLanguage.test.ts`](../../test/promptLanguage.test.ts), [`test/outputLanguageLabels.test.ts`](../../test/outputLanguageLabels.test.ts)");
  lines.push("- Fixture transcripts: [`test/fixtures/multilingual-jsonl/`](../../test/fixtures/multilingual-jsonl/)");
  lines.push("");
  lines.push("See [mindmap-output.md](./mindmap-output.md) for the output-language checklist.");
  lines.push("");
  return lines.join("\n");
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const english = readBundle(ENGLISH_FILE);

  for (const locale of LOCALES) {
    const target = readBundle(`bundle.l10n.${locale.id}.json`);
    const outPath = join(OUT_DIR, `${locale.id}.md`);
    writeFileSync(outPath, renderLocaleChecklist(locale, english, target), "utf8");
    console.log(`✓ ${locale.id}.md`);
  }

  writeFileSync(join(OUT_DIR, "REVIEW-STATUS.md"), renderReviewStatus(), "utf8");
  console.log("✓ REVIEW-STATUS.md");
  console.log(`Generated ${LOCALES.length} locale checklists in docs/multilingual-checklist/`);
}

main();
