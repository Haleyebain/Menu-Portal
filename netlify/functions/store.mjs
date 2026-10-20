// Shared storage for every bucket, backed by Netlify Blobs.
//
//   GET    /api/store/:bucket/:coll              -> { docs: [{ id, data }] }   only what this code may see
//   PUT    /api/store/:bucket/:coll/:id          -> save one document
//   DELETE /api/store/:bucket/:coll/:id          -> remove one document
//   GET    /api/store/:bucket/versions           -> { menus: [{ id, name, deleted }] }
//   GET    /api/store/:bucket/versions/:id       -> { versions: [{ ver, savedAt, editor }] }
//   GET    /api/store/:bucket/versions/:id/:ver  -> one earlier version of a menu
//
// Every call carries the access code in x-access-key. The code decides which
// buckets and which properties a person can read and write; the browser is
// never trusted to filter. Every save of a menu keeps the version it replaced.
import { getStore } from "@netlify/blobs";
import { resolveKey, json } from "./_lib/access.mjs";
import wineSeed from "../../data/wine-seed.json";

const COLLECTIONS = { "wine-lists": ["menus"], "special-menus": ["menus", "history"], "signage": ["signs"] };
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const VER = /^\d{13}(-[A-Za-z0-9_-]{0,64})?$/;
const MAX_BYTES = 1_000_000;
const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
const KEEP_VERSIONS = 300;

/* Which property a document belongs to. null means "not tied to one venue",
   which only an all-properties code may touch. */
const WINE_PROPS = { "sams": "sams", "alpin-room": "alpin", "the-cabin": "cabin", "cloud-nine": "c9" };
function propertyOf(bucket, coll, id, data) {
  if (bucket === "signage") return "*";   // signs are shared by everyone with the Basic Signage tool
  if (bucket === "wine-lists") return WINE_PROPS[id] || null;
  const menuId = coll === "history" ? String(data?.menu || id.replace(/-\d+$/, "")) : id;
  const p = menuId.split("-")[0];
  return ["sams", "alpin", "cabin", "c9", "elk", "up4", "twocreeks", "cliffhouse", "backyard"].includes(p) ? p : null;
}
const allowed = (meta, prop) => meta.allProperties || prop === "*" || (prop && meta.properties.includes(prop));

const b64u = s => Buffer.from(String(s || "").slice(0, 40), "utf8").toString("base64url");
const unb64u = s => { try { return Buffer.from(s || "", "base64url").toString("utf8"); } catch { return ""; } };

async function versionsOf(store, id) {
  const { blobs } = await store.list({ prefix: `v/${id}/` });
  return blobs.map(b => b.key.slice(`v/${id}/`.length)).filter(v => VER.test(v)).sort().reverse();
}
async function snapshot(store, id, data, editor, force) {
  if (!data) return;
  const vers = await versionsOf(store, id);
  const last = vers[0] ? Number(vers[0].slice(0, 13)) : 0;
  if (!force && Date.now() - last < SNAPSHOT_EVERY_MS) return;
  await store.setJSON(`v/${id}/${Date.now()}-${b64u(editor)}`, data);
  for (const old of vers.slice(KEEP_VERSIONS - 1)) await store.delete(`v/${id}/${old}`);
}
async function listColl(store, coll) {
  const { blobs } = await store.list({ prefix: `${coll}/` });
  return Promise.all(blobs.map(async b => ({ id: b.key.slice(coll.length + 1), data: await store.get(b.key, { type: "json" }) })));
}

export default async (req, context) => {
  const { bucket, coll, id, ver } = context.params || {};
  if (!COLLECTIONS[bucket]) return json({ error: "Unknown bucket" }, 404);

  let meta;
  try { meta = await resolveKey(req.headers.get("x-access-key")); }
  catch (e) { return json({ error: "access_unavailable", detail: e.message }, 503); }
  if (!meta) return json({ error: "invalid_key" }, 401);
  if (!meta.buckets.includes(bucket)) return json({ error: "not_entitled" }, 403);

  const store = getStore({ name: `portal-${bucket}`, consistency: "strong" });
  const editor = decodeURIComponent(req.headers.get("x-portal-email") || "").trim() || meta.label || meta.audience;

  /* ---------- version history of menus ---------- */
  if (coll === "versions") {
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
    if (!id) {
      const { directories } = await store.list({ prefix: "v/", directories: true });
      const ids = directories.map(d => d.replace(/^v\//, "").replace(/\/$/, "")).filter(x => ID.test(x));
      const menus = [];
      for (const x of ids) {
        const cur = await store.get(`menus/${x}`, { type: "json" });
        let name = cur?.name;
        if (!cur) { const v = (await versionsOf(store, x))[0]; name = v ? (await store.get(`v/${x}/${v}`, { type: "json" }))?.name : x; }
        const doc = cur || {};
        if (allowed(meta, propertyOf(bucket, "menus", x, doc))) menus.push({ id: x, name: name || x, deleted: !cur });
      }
      return json({ menus });
    }
    if (!ID.test(id)) return json({ error: "Unknown menu" }, 404);
    if (!allowed(meta, propertyOf(bucket, "menus", id))) return json({ error: "not_entitled" }, 403);
    if (!ver) return json({ versions: (await versionsOf(store, id)).map(v => ({ ver: v, savedAt: new Date(Number(v.slice(0, 13))).toISOString(), editor: unb64u(v.slice(14)) })) });
    if (!VER.test(ver)) return json({ error: "Unknown version" }, 404);
    const data = await store.get(`v/${id}/${ver}`, { type: "json" });
    return data ? json(data) : json({ error: "Unknown version" }, 404);
  }

  if (!COLLECTIONS[bucket].includes(coll)) return json({ error: "Unknown collection" }, 404);

  /* ---------- read a collection ---------- */
  if (req.method === "GET" && !id) {
    let docs = await listColl(store, coll);
    if (bucket === "wine-lists" && coll === "menus") {
      /* Starter menus are added once each, so a menu added in a later deploy (Cloud Nine)
         appears without touching the team's edits, and a menu the team deleted stays deleted. */
      const raw = await store.get("_seeded");
      let done = [];
      try { done = JSON.parse(raw || "[]"); } catch { done = ["sams", "alpin-room", "the-cabin"]; }   // first deploys stored a date
      if (!Array.isArray(done)) done = ["sams", "alpin-room", "the-cabin"];
      const fresh = Object.keys(wineSeed).filter(k => !done.includes(k));
      if (fresh.length) {
        const have = new Set(docs.map(d => d.id));
        for (const k of fresh) if (!have.has(k)) await store.setJSON(`menus/${k}`, wineSeed[k]);
        await store.set("_seeded", JSON.stringify(done.concat(fresh)));
        docs = await listColl(store, coll);
      }
    }
    docs = docs.filter(d => d.data && allowed(meta, propertyOf(bucket, coll, d.id, d.data)));
    return json({ docs });
  }

  if (!id || !ID.test(id)) return json({ error: "Unknown document" }, 404);

  /* ---------- write ---------- */
  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: "Too large" }, 413);
    let data;
    try { data = JSON.parse(text); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!data || typeof data !== "object") return json({ error: "Not a document" }, 400);
    if (!allowed(meta, propertyOf(bucket, coll, id, data))) return json({ error: "not_entitled" }, 403);
    if (coll === "menus") {
      const before = await store.get(`menus/${id}`, { type: "json" });
      if (before) await snapshot(store, id, before, before._editor || "", req.headers.get("x-restore") === "1");
      data._editor = editor;
    }
    await store.setJSON(`${coll}/${id}`, data);
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    const before = await store.get(`${coll}/${id}`, { type: "json" });
    if (!allowed(meta, propertyOf(bucket, coll, id, before))) return json({ error: "not_entitled" }, 403);
    if (coll === "menus" && before) await snapshot(store, id, before, before._editor || "", true);
    await store.delete(`${coll}/${id}`);
    return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
};

export const config = {
  path: [
    "/api/store/:bucket/:coll",
    "/api/store/:bucket/:coll/:id",
    "/api/store/:bucket/:coll/:id/:ver",
  ],
};
