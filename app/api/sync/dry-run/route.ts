import { guard } from "../../../../src/server/route";
import { DryRunBody, dryRun } from "../../../../src/server/sync";

// Dry run only. There is deliberately no live-write route.
export async function POST(req: Request) {
  const raw = await req.json().catch(() => ({}));
  return guard(req, (db) => dryRun(db, DryRunBody.parse(raw ?? {})));
}
