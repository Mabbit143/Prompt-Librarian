import { CATEGORIES, makeClassificationSchema, type Classification } from "./taxonomy.js";
import { BudgetExceededError, type BudgetPort, type Usage } from "./budget.js";

/** Model call. Receives text purely as data; has no tools and no write access. */
export type ModelCall = (text: string, categories: readonly string[]) => Promise<{ json: unknown; costUsd: number; usage?: Usage }>;

export type ClassifyResult =
  | { ok: true; value: Classification }
  | { ok: false; reason: "budget" | "invalid" | "error" };

export async function classifyWithRetry(text: string, call: ModelCall, budget: BudgetPort, estimateUsd = 0.001, maxAttempts = 2, categories: readonly string[] = CATEGORIES): Promise<ClassifyResult> {
  const schema = makeClassificationSchema(categories);
  let last: ClassifyResult = { ok: false, reason: "error" };
  for (let i = 0; i < maxAttempts; i++) {
    let hold;
    try { hold = await budget.reserve(estimateUsd); } catch (e) {
      if (e instanceof BudgetExceededError) return { ok: false, reason: "budget" };
      return { ok: false, reason: "error" };
    }
    try {
      const { json, costUsd, usage } = await call(text, categories);
      await hold.commit(costUsd, usage);
      const parsed = schema.safeParse(json);
      if (parsed.success) return { ok: true, value: parsed.data };
      last = { ok: false, reason: "invalid" };
    } catch {
      await hold.release();
      last = { ok: false, reason: "error" };
    }
  }
  return last;
}
