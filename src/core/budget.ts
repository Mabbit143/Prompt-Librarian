export class BudgetExceededError extends Error {}

export interface Usage { inputTokens: number; outputTokens: number }
export interface Hold {
  commit(actualUsd: number, usage?: Usage): Promise<void>;
  release(): Promise<void>;
}
/** Reserve before a billable call, settle after. Throws BudgetExceededError when the cap would be passed. */
export interface BudgetPort {
  reserve(estimateUsd: number): Promise<Hold>;
}

/** In-memory cap with reservations so concurrent jobs cannot jointly overshoot. Not a provider billing cap. */
export class Budget implements BudgetPort {
  private spent = 0;
  private reserved = 0;
  constructor(readonly capUsd: number, readonly warnUsd: number) {}
  async reserve(estimateUsd: number): Promise<Hold> {
    if (this.spent + this.reserved + estimateUsd > this.capUsd) throw new BudgetExceededError("AI budget exhausted");
    this.reserved += estimateUsd;
    let done = false;
    const settle = async (actual: number) => { if (done) return; done = true; this.reserved -= estimateUsd; this.spent += actual; };
    return { commit: (a) => settle(a), release: () => settle(0) };
  }
  get warning() { return this.spent + this.reserved >= this.warnUsd; }
  get totalSpent() { return this.spent; }
}
