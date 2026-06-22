/**
 * `exportMergedProject` use case — export the merged project mind map as an offline package.
 *
 * Same flow as `exportSession` but reads the merged project mind map from the store.
 */
import type { MindMapSink } from "../ports/MindMapSink";
import type { StoreAccess } from "../ports/StoreAccess";
import type { Prompter } from "../ports/Prompter";
import type { Logger } from "../ports/Logger";
import type { MindMapUiOptions } from "../ui/mindMapUiTypes";
import { exportMindMapPackage, type ExportPackageResult } from "../export/exportPackage";

export type ExportMergedProjectDeps = {
  mindMapSink: MindMapSink;
  storeAccess: StoreAccess;
  prompter: Prompter;
  logger: Logger;
  /** The project slug. */
  projectSlug: string;
  /** The media directory (extension's media/ path). */
  mediaDir: string;
  /** Output directory. If not set, the Prompter is used for folder selection. */
  outDir?: string;
  /** UI config for the exported package. */
  uiConfig?: MindMapUiOptions;
};

/**
 * Export the merged project mind map as an offline package.
 *
 * Returns `undefined` when no merge snapshot exists or the user cancels.
 */
export async function exportMergedProject(
  deps: ExportMergedProjectDeps
): Promise<ExportPackageResult | undefined> {
  const store = await deps.storeAccess.getStore();
  const mergeRecord = await store.readConceptTrieMerge();
  if (!mergeRecord?.mindMap) {
    deps.logger.warn("No merged project mind map available. Run project analysis first.");
    return undefined;
  }

  const outDir =
    deps.outDir ??
    (await deps.prompter.showInputBox({
      prompt: "Select output directory",
      value: `./agent-mindmap-export/${deps.projectSlug}`,
    }));

  if (!outDir) {
    return undefined;
  }

  try {
    const result = await exportMindMapPackage({
      outDir,
      mindMap: mergeRecord.mindMap,
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
