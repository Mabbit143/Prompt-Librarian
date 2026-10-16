import { guard } from "../../../../src/server/route";
import { queryOf } from "../../../../src/server/http";
import { SyncQuery, buildSyncPreview } from "../../../../src/server/sync";

export const GET = (req: Request) => guard(req, (db) => buildSyncPreview(db, SyncQuery.parse(queryOf(req))));
