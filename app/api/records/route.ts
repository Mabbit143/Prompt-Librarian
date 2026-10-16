import { guard } from "../../../src/server/route";
import { queryOf } from "../../../src/server/http";
import { ListQuery, listRecords } from "../../../src/server/queries";

export const GET = (req: Request) => guard(req, (db) => listRecords(db, ListQuery.parse(queryOf(req))));
