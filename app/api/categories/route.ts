import { guard } from "../../../src/server/route";

export const GET = (req: Request) => guard(req, async (db) => {
  const { data, error } = await db.from("categories").select("name").order("name");
  if (error) throw new Error(error.message);
  return { items: data.map((c) => c.name as string) };
});
