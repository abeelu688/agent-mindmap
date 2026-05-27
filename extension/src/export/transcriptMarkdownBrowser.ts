import { renderTranscriptMarkdownHtml } from "./renderTranscriptMarkdownHtml";

declare global {
  interface Window {
    renderTranscriptMarkdown: (md: string) => string;
  }
}

window.renderTranscriptMarkdown = renderTranscriptMarkdownHtml;
