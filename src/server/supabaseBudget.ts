import type { SupabaseClient } from "@supabase/supabase-js";
import { BudgetExceededError, type BudgetPort, type Hold } from "../core/budget.js";

/** Budget backed by ai_usage. The cap comes from users.settings.ai_budget_usd inside the database, not from the caller. */
export class SupabaseBudget implements BudgetPort {
  constructor(private db: SupabaseClient, private operation: string, private model: string) {}

  async reserve(estimateUsd: number): Promise<Hold> {
    const { data, error } = await this.db.rpc("reserve_ai_budget", { p_estimate: estimateUsd, p_operation: this.operation, p_model: this.model });
    if (error) {
      if (error.message.includes("budget_exceeded")) throw new BudgetExceededError("AI budget exhausted");
      throw new Error(error.message);
    }
    const id = data as string;
    return {
      commit: async (actual, usage) => {
        const { error: e } = await this.db.rpc("settle_ai_usage", { p_id: id, p_input: usage?.inputTokens ?? 0, p_output: usage?.outputTokens ?? 0, p_cost: actual });
        if (e) throw new Error(e.message);
      },
      release: async () => { await this.db.rpc("release_ai_usage", { p_id: id }); },
    };
  }
}
