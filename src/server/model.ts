import type { ModelCall } from "../core/classify.js";

/**
 * Placeholder until the OpenAI adapter exists (model IDs and Structured Outputs support still unverified).
 * It throws, so captures are saved and routed to the review queue with reason "classifier error".
 */
export const unconfiguredModel: ModelCall = async () => {
  throw new Error("Classifier not configured");
};
