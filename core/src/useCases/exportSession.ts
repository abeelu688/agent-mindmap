/**
 * `exportSession` use case — export a single session's mind map as an offline package.
 *
 * Reuses `exportMindMapPackage` from core's export module.
 * The Prompter is used for folder selection (extension: VS Code file dialog;
 * CLI: path argument or default directory).
 */
import type { MindMapSink } from "../ports/MindMapSink";
import type { Prompter } from "../ports/Prompter";
import type { Logger } from "../ports/Logger";
import type { MindMapRoot } from "../transcript/types";
import type { MindMapUiOptions } from "../ui/mindMapUiTypes";
import { exportMindMapPackage, type ExportPackageResult } from "../export/exportPackage";

export type ExportSessionDeps = {
  mindMapSink: MindMapSink;
  prompter: Prompter;
  logger: Logger;
  /** The mind map data to export. */
  mindMap: MindMapRoot | undefined;
  /** The media directory (extension's media/ path). */
  mediaDir: string;
  /** Output directory. If not set, the Prompter is used for folder selection. */
  outDir?: string;
  /** UI config for the exported package. */
  uiConfig?: MindMapUiOptions;
};

/**
 * Export a session mind map as an offline package.
 *
 * Returns `undefined` when no mind map is available or the user cancels.
 */
export async function exportSession(
  deps: ExportSessionDeps
): Promise<ExportPackageResult | undefined> {
  if (!deps.mindMap) {
    deps.logger.warn("No mind map data available for export");
    return undefined;
  }

  const outDir =
    deps.outDir ??
    (await deps.prompter.showInputBox({
      prompt: "Select output directory",
      value: "./agent-mindmap-export",
    }));

  if (!outDir) {
    return undefined;
  }

  try {
    const result = await exportMindMapPackage({
      outDir,
      mindMap: deps.mindMap,
      mediaDir: deps.mediaDir,
      ui: deps.uiConfig ?? { preset: "auto", direction: 2 },
      onWarning: (msg) => deps.logger.warn(msg),
    });
    return result;
  } catch (err) {
    deps.logger.error("Export failed", err);
    return undefined;
  }
}
