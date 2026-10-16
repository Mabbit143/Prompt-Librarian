import { guard } from "../../../src/server/route";
import { queryOf } from "../../../src/server/http";
import { ReviewListQuery, listReviews } from "../../../src/server/reviews";

export const GET = (req: Request) => guard(req, (db) => listReviews(db, ReviewListQuery.parse(queryOf(req))));
