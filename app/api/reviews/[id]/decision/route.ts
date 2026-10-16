import { guard } from "../../../../../src/server/route";
import { IdParam } from "../../../../../src/server/queries";
import { DecisionBody, decideReview } from "../../../../../src/server/reviews";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  return guard(req, (db) => decideReview(db, IdParam.parse(id), DecisionBody.parse(raw)));
}
