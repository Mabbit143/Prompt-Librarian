import { guard } from "../../../../src/server/route";
import { IdParam, getRecord } from "../../../../src/server/queries";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guard(req, (db) => getRecord(db, IdParam.parse(id)));
}
