import { guard } from "../../../src/server/route";
import { queryOf } from "../../../src/server/http";
import { SearchQuery, searchRecords } from "../../../src/server/queries";

export const GET = (req: Request) => guard(req, (db) => searchRecords(db, SearchQuery.parse(queryOf(req))));
