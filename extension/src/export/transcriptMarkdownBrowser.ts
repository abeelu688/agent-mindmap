import { renderTranscriptMarkdownHtml } from "./renderTranscriptMarkdownHtml";

declare global {
  interface Window {
    renderTranscriptMarkdown: (md: string) => string;
  }
  // This module is bundled for the browser (esbuild IIFE); `window` is not part
  // of the extension's Node lib, so declare it locally for typechecking.
  var window: Window & typeof globalThis;
}

window.renderTranscriptMarkdown = renderTranscriptMarkdownHtml;
