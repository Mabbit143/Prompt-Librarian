import { ClassificationSchema, type Classification } from "./taxonomy.js";
import { Budget, BudgetExceededError } from "./budget.js";

/** Model call. Receives text purely as data; has no tools and no write access. */
export type ModelCall = (text: string) => Promise<{ json: unknown; costUsd: number }>;

export type ClassifyResult =
  | { ok: true; value: Classification }
  | { ok: false; reason: "budget" | "invalid" | "error" };

export async function classifyWithRetry(text: string, call: ModelCall, budget: Budget, estimateUsd = 0.001, maxAttempts = 2): Promise<ClassifyResult> {
  let last: ClassifyResult = { ok: false, reason: "error" };
  for (let i = 0; i < maxAttempts; i++) {
    let hold;
    try { hold = budget.reserve(estimateUsd)(); } catch (e) {
      if (e instanceof BudgetExceededError) return { ok: false, reason: "budget" };
      throw e;
    }
    try {
      const { json, costUsd } = await call(text);
      hold.commit(costUsd);
      const parsed = ClassificationSchema.safeParse(json);
      if (parsed.success) return { ok: true, value: parsed.data };
      last = { ok: false, reason: "invalid" };
    } catch {
      hold.release();
      last = { ok: false, reason: "error" };
    }
  }
  return last;
}
