# Changelog

## 0.2.3

- Extension UI is now available in 10 languages: Simplified Chinese, English, Japanese, Korean, Brazilian Portuguese, Spanish, German, French, Hindi, and Indonesian. In settings, set **Agent Mind Map › Ui › Locale** to your language, or leave **auto** to follow your VS Code display language.
- Mind map titles and labels (such as "Related code" and "Research") now also support Portuguese, Spanish, German, French, Hindi, and Indonesian — in addition to Chinese, English, Japanese, and Korean — based on the language of your agent conversations.
- Improved language detection for mixed-language transcripts so generated mind maps better match how you ask questions.
- The mind map panel — batch progress bar, refresh button, and right-click menu — now appears in your chosen UI language.
- Fixed cases where code-reference extraction failures could produce incorrect or incomplete mind maps.
- **Force re-analyze all** now fully clears this project's saved analysis (session library and merge cache) before re-running, and waits for you to click **Refresh** when updates are ready.

## 0.2.2

- Mind maps now follow the language of your agent conversations. Titles, summaries, and labels such as "Related code" and "Research" are generated in Chinese, English, Japanese, or Korean based on the questions in the transcript.
- Added a setting to override the output language when auto-detection does not match your preference.
- Added Japanese and Korean options for extension UI language.
- Fixed missing "Related code" nodes and file links in some sessions.

## 0.2.1

- Updated extension marketplace details with a clearer product overview, feature list, usage guide, settings summary, privacy note, GitHub repository link, and feedback path.
- Optimized code reference extraction via LLM for more accurate file path and line range detection.

## 0.2.0

- Added Cursor and Claude Code transcript support.
- Added single-session mind maps generated from agent conversations.
- Added project-level concept maps that merge multiple analyzed sessions.
- Added click-to-source transcript navigation from mind-map nodes.
- Added offline export for mind maps and linked transcript files.
- Added local session library, LLM cache, UI theme, layout, and locale settings.
