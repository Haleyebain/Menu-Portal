// Digital Menus: what a save may change. The browser hides what a code can't edit,
// but this check is the real lock.
//
//   Every code with the Digital Menus tool: show or hide items, edit items marked
//   special (name, ingredients, price), swap dishes between the Wok board and the
//   rotating items, switch the Wok closed screen on or off.
//   Codes with digital-pricing: also every price.
//   Nobody: item names and descriptions that aren't specials, which items exist,
//   which items are specials.

export const DIGITAL_PROPS = ["sundeck", "merrygoround", "ullrhof", "buttermilk", "highalpine"];

const MAX_TEXT = 400;
const META = ["updatedAt", "updatedBy", "clientId", "_editor"];

function stable(v) {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}

// The document with every field this code may change taken out. Two saves are
// allowed to differ only in what was taken out.
function locked(doc, canPrice) {
  const d = JSON.parse(JSON.stringify(doc || {}));
  for (const k of META) delete d[k];
  for (const it of Object.values(d.items || {})) {
    if (!it || typeof it !== "object") continue;
    delete it.hidden;
    if (it.special) { delete it.name; delete it.desc; delete it.price; }
    if (canPrice) delete it.price;
    for (const o of Array.isArray(it.opts) ? it.opts : []) if (o && (canPrice || it.special)) delete o.price;
  }
  if (d.wok && typeof d.wok === "object") {
    delete d.wok.closed;
    if (canPrice) delete d.wok.price;
    d.wok.dishes = [...(d.wok.slots || []), ...(d.wok.pool || [])].map(String).sort();
    d.wok.slotCount = (d.wok.slots || []).length;
    delete d.wok.slots; delete d.wok.pool;
  }
  return stable(d);
}

function wellFormed(doc) {
  if (!doc || typeof doc !== "object" || !doc.items || typeof doc.items !== "object" || !doc.wok) return false;
  for (const it of Object.values(doc.items)) {
    if (!it || typeof it !== "object" || typeof it.hidden !== "boolean") return false;
    for (const k of ["name", "desc", "price"]) if (it[k] != null && (typeof it[k] !== "string" || it[k].length > MAX_TEXT)) return false;
    for (const o of Array.isArray(it.opts) ? it.opts : []) if (o && o.price != null && (typeof o.price !== "string" || o.price.length > 40)) return false;
  }
  const w = doc.wok;
  if (!Array.isArray(w.slots) || !Array.isArray(w.pool) || typeof w.closed !== "boolean") return false;
  if (new Set([...w.slots, ...w.pool]).size !== w.slots.length + w.pool.length) return false;   // no dish twice
  if (![...w.slots, ...w.pool].every(id => doc.items[id])) return false;
  if (w.price != null && (typeof w.price !== "string" || w.price.length > 40)) return false;
  return true;
}

export function digitalEditAllowed(before, after, canPrice) {
  if (!wellFormed(after)) return false;
  return locked(before, canPrice) === locked(after, canPrice);
}
