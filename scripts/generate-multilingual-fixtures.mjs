#!/usr/bin/env node
/**
 * Regenerate multilingual JSONL fixtures from shared code/tool templates.
 * Only user_query text differs by language; tool_use paths and code edits are identical.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = path.join(ROOT, "test/fixtures/multilingual-jsonl/cursor-projects");

const PROJECTS = [
  { slug: "zh-inventory-admin", lang: "zh" },
  { slug: "en-payments-api", lang: "en" },
  { slug: "ja-docs-portal", lang: "ja" },
  { slug: "ko-observability-hub", lang: "ko" },
];

const LOG_BLOCK = `2026-06-14T11:20:33Z ERROR sync-worker failed request_id=abc-123 tenant=west
Traceback (most recent call last):
  File "/srv/sync/jobs.py", line 88, in run
  File "/srv/sync/client.py", line 41, in fetch
ConnectionError: upstream timeout after 30000ms`;

const SUMMARY_SUFFIX =
  "\n\nKey areas covered: data flow, validation, error handling, and user-facing behavior. This summary is intentionally long enough for parser extraction.";

const ASSISTANT_SUMMARIES = {
  1: "Updated session refresh logic and permission guards." + SUMMARY_SUFFIX,
  2: "Added retry policy and alert hooks for sync timeouts." + SUMMARY_SUFFIX,
  3: "Documented CSV validation errors, import job flow, and error report helper." + SUMMARY_SUFFIX,
  4: "Tightened stock reservation lock boundaries for concurrency." + SUMMARY_SUFFIX,
  5: "Organized export job queue, permissions, and download links." + SUMMARY_SUFFIX,
};

const FOLLOW_UP_ASSISTANT =
  "Follow-up captured for output-language stability testing.";

const USER_QUERIES = {
  zh: {
    1: [
      "请帮我梳理后台登录流程，重点看 session 刷新和权限校验。",
      "请继续保持中文输出，不要因为代码标识符、日志或路径里有英文就切换语言。",
    ],
    2: [
      `下面是英文日志，但我的问题是中文：\n${LOG_BLOCK}\n这个同步超时应该在哪一层加重试和告警？`,
      "请继续保持中文输出，不要因为代码标识符、日志或路径里有英文就切换语言。",
    ],
    3: [
      "看一下商品批量导入，帮我把 CSV 校验错误整理到导图里，并补全 importJob 与 errorReport 相关代码。",
      "请继续保持中文输出，不要因为代码标识符、日志或路径里有英文就切换语言。",
    ],
    4: [
      "订单占库存这块有并发问题，帮我分析锁的边界。",
      "请继续保持中文输出，不要因为代码标识符、日志或路径里有英文就切换语言。",
    ],
    5: [
      "请把报表导出的权限、队列和下载链接这几个概念合并成清晰层级。",
      "请继续保持中文输出，不要因为代码标识符、日志或路径里有英文就切换语言。",
    ],
  },
  en: {
    1: [
      "Map the backend login flow and explain session refresh plus permission checks.",
      "Please keep this session output language as English even if code identifiers are English.",
    ],
    2: [
      `Below is a production log snippet, but answer in English:\n${LOG_BLOCK}\nWhere should retry and alerting be applied for this sync timeout?`,
      "Please keep this session output language as English even if code identifiers are English.",
    ],
    3: [
      "Review bulk product import and put CSV validation errors on the mind map, including importJob and errorReport code.",
      "Please keep this session output language as English even if code identifiers are English.",
    ],
    4: [
      "We have a concurrency issue in stock reservation—help me analyze lock boundaries.",
      "Please keep this session output language as English even if code identifiers are English.",
    ],
    5: [
      "Merge export permissions, queueing, and download links into a clear hierarchy on the mind map.",
      "Please keep this session output language as English even if code identifiers are English.",
    ],
  },
  ja: {
    1: [
      "バックエンドのログインフローを整理し、session 更新と権限チェックの要点を教えてください。",
      "日本語で出力を続けてください。コード識別子が英語でも切り替えないでください。",
    ],
    2: [
      `以下は英語ログですが、質問は日本語です：\n${LOG_BLOCK}\nこの同期タイムアウトへのリトライとアラートはどの層で入れるべきですか？`,
      "日本語で出力を続けてください。コード識別子が英語でも切り替えないでください。",
    ],
    3: [
      "商品一括インポートを確認し、CSV 検証エラーをマインドマップに載せてください。importJob と errorReport のコードも含めてください。",
      "日本語で出力を続けてください。コード識別子が英語でも切り替えないでください。",
    ],
    4: [
      "在庫予約の並行処理で問題があります。ロック境界を分析してください。",
      "日本語で出力を続けてください。コード識別子が英語でも切り替えないでください。",
    ],
    5: [
      "レポートエクスポートの権限、キュー、ダウンロードリンクを階層的に整理してください。",
      "日本語で出力を続けてください。コード識別子が英語でも切り替えないでください。",
    ],
  },
  ko: {
    1: [
      "백엔드 로그인 흐름을 정리하고 session 갱신과 권한 검사 포인트를 설명해 주세요.",
      "한국어 출력을 유지해 주세요. 코드 식별자가 영어여도 언어를 바꾸지 마세요.",
    ],
    2: [
      `아래 로그는 영어지만 질문은 한국어입니다.\n${LOG_BLOCK}\n이 동기화 타임아웃에 재시도와 알림은 어느 계층에서 처리해야 하나요?`,
      "한국어 출력을 유지해 주세요. 코드 식별자가 영어여도 언어를 바꾸지 마세요.",
    ],
    3: [
      "상품 일괄 import를 검토하고 CSV 검증 오류를 마인드맵에 포함해 주세요. importJob과 errorReport 코드도 넣어 주세요.",
      "한국어 출력을 유지해 주세요. 코드 식별자가 영어여도 언어를 바꾸지 마세요.",
    ],
    4: [
      "재고 예약 concurrency 문제가 있습니다. lock 경계를 분석해 주세요.",
      "한국어 출력을 유지해 주세요. 코드 식별자가 영어여도 언어를 바꾸지 마세요.",
    ],
    5: [
      "리포트 export 권한, queue, download link 개념을 계층적으로 정리해 주세요.",
      "한국어 출력을 유지해 주세요. 코드 식별자가 영어여도 언어를 바꾸지 마세요.",
    ],
  },
};

/** Shared tool_use + assistant_summary blocks per session (identical across languages). */
function sharedMiddleLines(sessionNo) {
  const lines = [];
  const push = (obj) => lines.push(JSON.stringify(obj));

  if (sessionNo === 1) {
    push({ role: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { path: "src/auth/session.ts" } }] } });
    push({
      role: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "StrReplace",
          input: {
            file_path: "src/auth/session.ts",
            old_string: "export const FIXTURE_MARKER",
            new_string: "export function refreshSession(token: string) {\n  return { token, refreshed: true };\n}\nexport const FIXTURE_MARKER",
          },
        }],
      },
    });
  } else if (sessionNo === 2) {
    push({ role: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { path: "src/sync/retryPolicy.ts" } }] } });
    push({
      role: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "StrReplace",
          input: {
            file_path: "src/sync/retryPolicy.ts",
            old_string: "export const FIXTURE_MARKER",
            new_string: "export function classifyRetry(error: string) {\n  return error.includes('timeout') ? 'retry' : 'fail';\n}\nexport const FIXTURE_MARKER",
          },
        }],
      },
    });
  } else if (sessionNo === 3) {
    push({ role: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { path: "src/import/csvValidator.ts" } }] } });
    push({ role: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { path: "src/import/importJob.ts" } }] } });
    push({
      role: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "StrReplace",
          input: {
            file_path: "src/import/csvValidator.ts",
            old_string: "export const FIXTURE_MARKER",
            new_string: "export function validateCsvRow(row: Record<string, string>) {\n  if (!row.sku) throw new Error('missing sku');\n}\nexport const FIXTURE_MARKER",
          },
        }],
      },
    });
    push({
      role: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "StrReplace",
          input: {
            file_path: "src/import/importJob.ts",
            old_string: "export const FIXTURE_MARKER",
            new_string: "export async function runImportJob(filePath: string) {\n  return { imported: 12, failed: 3, filePath };\n}\nexport const FIXTURE_MARKER",
          },
        }],
      },
    });
    push({
      role: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "Write",
          input: {
            file_path: "src/import/errorReport.ts",
            contents: "export function buildImportErrorReport(errors: Array<{ row: number; message: string }>) {\n  return errors.map((e) => `row ${e.row}: ${e.message}`).join('\\n');\n}\n",
          },
        }],
      },
    });
  } else if (sessionNo === 4) {
    push({ role: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { path: "src/reservation/stockLock.ts" } }] } });
    push({
      role: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "StrReplace",
          input: {
            file_path: "src/reservation/stockLock.ts",
            old_string: "export const FIXTURE_MARKER",
            new_string: "export function acquireStockLock(sku: string) {\n  return { sku, locked: true };\n}\nexport const FIXTURE_MARKER",
          },
        }],
      },
    });
  } else if (sessionNo === 5) {
    push({ role: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { path: "src/report/exportJob.ts" } }] } });
    push({
      role: "assistant",
      message: {
        content: [{
          type: "tool_use",
          name: "StrReplace",
          input: {
            file_path: "src/report/exportJob.ts",
            old_string: "export const FIXTURE_MARKER",
            new_string: "export function enqueueExportJob(userId: string) {\n  return { userId, queued: true };\n}\nexport const FIXTURE_MARKER",
          },
        }],
      },
    });
  }

  push({
    role: "assistant",
    message: { content: [{ type: "text", text: ASSISTANT_SUMMARIES[sessionNo] }] },
  });

  return lines;
}

function userLine(text) {
  return JSON.stringify({
    role: "user",
    message: { content: [{ type: "text", text: `<user_query>\n${text}\n</user_query>` }] },
  });
}

function assistantLine(text) {
  return JSON.stringify({
    role: "assistant",
    message: { content: [{ type: "text", text }] },
  });
}

function buildSessionJsonl(lang, sessionNo) {
  const [q1, q2] = USER_QUERIES[lang][sessionNo];
  return [
    userLine(q1),
    ...sharedMiddleLines(sessionNo),
    userLine(q2),
    assistantLine(FOLLOW_UP_ASSISTANT),
  ].join("\n") + "\n";
}

async function main() {
  for (const { slug, lang } of PROJECTS) {
    for (let n = 1; n <= 5; n++) {
      const sessionId = `${slug}-${String(n).padStart(3, "0")}`;
      const dir = path.join(OUT_ROOT, slug, sessionId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `${sessionId}.jsonl`),
        buildSessionJsonl(lang, n),
        "utf8"
      );
    }
  }
  console.log(`Generated ${PROJECTS.length * 5} sessions under ${OUT_ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
