export type FeedbackKind = "like" | "dislike" | "neutral";

export interface FeedbackState {
  likes: number;
  dislikes: number;
  my_vote: "like" | "dislike" | null;
}

const API_BASE = "/api/feedback";

export async function fetchFeedback(
  slug: string,
  signal?: AbortSignal,
): Promise<FeedbackState> {
  const response = await fetch(
    `${API_BASE}?slug=${encodeURIComponent(slug)}`,
    { signal },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseFeedbackState(await response.json());
}

export async function postFeedback(
  slug: string,
  kind: FeedbackKind,
): Promise<FeedbackState> {
  const response = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, kind }),
  });
  if (response.status === 429) throw new Error("rate-limited");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseFeedbackState(await response.json());
}

export function parseFeedbackState(value: unknown): FeedbackState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid-feedback-response");
  }
  const data = value as Record<string, unknown>;
  const likes = Number(data.likes);
  const dislikes = Number(data.dislikes);
  const vote = data.my_vote;
  if (
    !Number.isSafeInteger(likes)
    || likes < 0
    || !Number.isSafeInteger(dislikes)
    || dislikes < 0
    || (vote !== "like" && vote !== "dislike" && vote !== null)
  ) {
    throw new Error("invalid-feedback-response");
  }
  return { likes, dislikes, my_vote: vote };
}
