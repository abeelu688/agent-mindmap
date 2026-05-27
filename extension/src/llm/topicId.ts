import { sha256Hex } from "../store/sessionStore";
import type { Topic } from "./types";

/**
 * Stable id for classifying a topic across runs.
 *
 * Must stay consistent with the prompt that asks the LLM to return topicIds.
 */
export function topicIdForTopic(
  sessionId: string,
  topic: Pick<Topic, "title" | "items">
): string {
  const items = (topic.items ?? []).map((i) => i.text).slice(0, 8);
  return sha256Hex(JSON.stringify({ sessionId, title: topic.title, items })).slice(
    0,
    24
  );
}

