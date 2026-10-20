// Who is this code? One place answers that for every function.
//
// Source of truth, first match wins:
//   1. ACCESS_FEED_URL  the Apps Script web app that reads the Access tab of the
//                       Google Sheet (see apps-script/Code.gs). Rotating a code is
//                       editing a cell, no deploy.
//   2. ACCESS_CODES     a JSON env var for getting started before the Sheet exists:
//                       {"CODE":{"audience":"F&B Leadership","label":"All venues",
//                                "buckets":"all","properties":"all"}}
// Codes never live in shipped HTML or JS.

export const BUCKETS = { "wine-lists": "Wine Lists", "special-menus": "Special Menus", "signage": "Basic Signage" };
export const PROPERTIES = { sams: "Sam’s", alpin: "Alpin Room", cabin: "The Cabin", c9: "Cloud Nine", elk: "Elk Camp", up4: "Up 4 Pizza", twocreeks: "Two Creeks Café", cliffhouse: "Cliffhouse", backyard: "Backyard" };

const BUCKET_WORDS = {
  "wine-lists": "wine-lists", "wine-list": "wine-lists", "wine": "wine-lists", "wines": "wine-lists",
  "special-menus": "special-menus", "special-menu": "special-menus", "special": "special-menus", "specials": "special-menus",
  "signage": "signage", "signs": "signage", "sign": "signage", "basic signage": "signage", "basic-signage": "signage",
};
const PROPERTY_WORDS = {
  "sams": "sams", "sam's": "sams", "sam’s": "sams", "sam": "sams",
  "alpin": "alpin", "alpin-room": "alpin", "alpin room": "alpin",
  "cabin": "cabin", "the-cabin": "cabin", "the cabin": "cabin",
  "c9": "c9", "cloud-nine": "c9", "cloud nine": "c9", "cloud9": "c9",
  "elk": "elk", "elk camp": "elk", "elk-camp": "elk", "elkcamp": "elk",
  "up4": "up4", "up 4 pizza": "up4", "up4 pizza": "up4", "up-4-pizza": "up4", "up4pizza": "up4",
  "twocreeks": "twocreeks", "two creeks": "twocreeks", "two-creeks": "twocreeks", "two creeks cafe": "twocreeks", "two creeks café": "twocreeks",
  "cliffhouse": "cliffhouse", "cliff house": "cliffhouse", "cliff-house": "cliffhouse",
  "backyard": "backyard", "back yard": "backyard",
};

// "all", "none", or a comma list. Unknown words are dropped, never guessed.
function words(cell, table, everything) {
  if (cell == null) return [];
  const toks = (Array.isArray(cell) ? cell : String(cell).split(",")).map(t => String(t).trim().toLowerCase()).filter(Boolean);
  if (toks.length === 1 && toks[0] === "all") return everything.slice();
  const out = [];
  for (const t of toks) { const v = table[t]; if (v && !out.includes(v)) out.push(v); }
  return out;
}

export function shape(raw, key) {
  const ent = raw.entitlements || raw;
  return {
    audience: String(raw.audience || "Team"),
    label: String(raw.label || raw.audience || ""),
    buckets: words(ent.buckets, BUCKET_WORDS, Object.keys(BUCKETS)),
    properties: words(ent.properties, PROPERTY_WORDS, Object.keys(PROPERTIES)),
    allProperties: String(ent.properties || "").trim().toLowerCase() === "all",
    key,
  };
}

const CACHE = new Map();   // key -> { at, meta }   60 s, so a rotated code dies within a minute
const TTL = 60 * 1000;

export async function resolveKey(rawKey) {
  const key = String(rawKey || "").trim().toUpperCase();
  if (!key || key.length > 40) return null;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.meta;

  let meta = null;
  const feed = (Netlify.env.get("ACCESS_FEED_URL") || "").trim();
  if (feed) {
    const r = await fetch(feed + (feed.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(key), { redirect: "follow" });
    const text = await r.text();
    if (/^\s*</.test(text)) throw new Error(/accounts\.google|sign ?in/i.test(text.slice(0, 600))
      ? "The access sheet feed asks for a Google sign-in. In Apps Script set Who has access to Anyone and deploy a new version."
      : "The access sheet feed answered with a web page instead of data.");
    const obj = JSON.parse(text);
    if (obj.__error === "invalid_key") meta = null;
    else if (obj.__error) throw new Error("Access sheet error: " + obj.__error);
    else if (obj.__meta) meta = shape(obj.__meta, key);
  } else {
    let codes = {};
    try { codes = JSON.parse(Netlify.env.get("ACCESS_CODES") || "{}"); } catch { throw new Error("ACCESS_CODES is not valid JSON."); }
    const found = Object.entries(codes).find(([k]) => k.trim().toUpperCase() === key);
    if (!found && !Object.keys(codes).length) throw new Error("No access codes are set up yet. Add ACCESS_FEED_URL or ACCESS_CODES in Netlify.");
    meta = found ? shape(found[1], key) : null;
  }
  CACHE.set(key, { at: Date.now(), meta });
  return meta;
}

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
