export class BudgetExceededError extends Error {}

/** Application-level cap with reservations so concurrent jobs cannot jointly overshoot. Not a provider billing cap. */
export class Budget {
  private spent = 0;
  private reserved = 0;
  constructor(readonly capUsd: number, readonly warnUsd: number) {}
  reserve(estimateUsd: number): () => { commit: (actualUsd: number) => void; release: () => void } {
    if (this.spent + this.reserved + estimateUsd > this.capUsd) throw new BudgetExceededError("AI budget exhausted");
    this.reserved += estimateUsd;
    let done = false;
    const settle = (actual: number) => { if (done) return; done = true; this.reserved -= estimateUsd; this.spent += actual; };
    return () => ({ commit: settle, release: () => settle(0) });
  }
  get warning() { return this.spent + this.reserved >= this.warnUsd; }
  get totalSpent() { return this.spent; }
}
