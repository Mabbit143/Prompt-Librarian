// node scripts/make-notion-snapshot.cjs <saved-notion-fetch.txt> <out.json>
// Reduces a saved Notion `fetch` result (database schema) to a compact, committed snapshot: property types and option names only.
const fs = require("fs");
const raw = fs.readFileSync(process.argv[2], "utf8");
let text = raw;
try { text = JSON.parse(raw).text; } catch {}
const dsUrl = text.match(/collection:\/\/[0-9a-f-]{36}/)[0].replace("collection://", "");
const state = JSON.parse(text.match(/<data-source-state>\s*(\{[\s\S]*?\})\s*<\/data-source-state>/)[1]);
const properties = {};
for (const [name, p] of Object.entries(state.schema)) {
  properties[name] = { type: p.type, ...(p.options ? { options: p.options.map((o) => o.name) } : {}) };
}
fs.writeFileSync(process.argv[3], JSON.stringify({ dataSourceId: dsUrl, name: state.name, fetchedAt: new Date().toISOString(), verified: true, properties }, null, 1) + "\n");
console.log(state.name, dsUrl, Object.keys(properties).length, "properties");
