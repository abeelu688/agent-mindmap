import * as vscode from "vscode";

export function buildMindMapHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "webview.js")
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "webview.css")
  );
  const cspSource = webview.cspSource;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource}; img-src ${cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Agent Mind Map</title>
</head>
<body>
  <div id="app">
    <div id="mindMapContainer"></div>
    <div id="mindmapLoading" class="mindmap-loading mindmap-loading--hidden" hidden aria-live="polite">
      <div class="mindmap-loading__spinner" aria-hidden="true"></div>
      <p class="mindmap-loading__title"></p>
      <p class="mindmap-loading__message"></p>
    </div>
  </div>
  <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}
