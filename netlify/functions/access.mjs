// The door. POST /api/access {key} -> what this code may open.
import { resolveKey, json, BUCKETS, PROPERTIES } from "./_lib/access.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let key = "";
  try { key = (await req.json()).key || ""; } catch { return json({ error: "Bad request" }, 400); }
  let meta;
  try { meta = await resolveKey(key); }
  catch (e) { return json({ error: "access_unavailable", detail: e.message }, 503); }
  if (!meta) return json({ error: "invalid_key" }, 401);
  return json({
    audience: meta.audience, label: meta.label,
    buckets: meta.buckets.map(id => ({ id, name: BUCKETS[id] })),
    properties: meta.properties.map(id => ({ id, name: PROPERTIES[id] })),
    allProperties: meta.allProperties,
  });
};

export const config = { path: "/api/access" };
