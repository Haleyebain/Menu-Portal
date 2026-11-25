// Digital Menus: what a save may change. The browser hides what a code can't edit,
// but this check is the real lock.
//
//   Every code with the Digital Menus tool: show or hide items, edit items marked
//   special (name, ingredients, price), swap dishes between the Wok board and the
//   rotating items, switch the Wok closed screen on or off and write its message, move dishes up, down
//   and between the two columns of the Soup and Grill boards.
//   Codes with digital-pricing: also every price.
//   Nobody: item names and descriptions that aren't specials, which items exist,
//   which items are specials.

export const DIGITAL_PROPS = ["sundeck", "merrygoround", "ullrhof", "buttermilk", "highalpine"];

const MAX_TEXT = 400;
// boards whose column layout may be rearranged, and the item-id prefix of the dishes on each
const MOVABLE = { soup: "sp-", grill1: "g1-", grill2: "g2-", grill3: "g3-" };
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
  delete d.cols;   // column layout is free to change; wellFormed() keeps each dish on its own board
  if (d.wok && typeof d.wok === "object") {
    delete d.wok.closed; delete d.wok.closedText;
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
  if (w.closedText != null && (typeof w.closedText !== "string" || w.closedText.length > 200)) return false;
  if (doc.cols != null) {
    if (typeof doc.cols !== "object" || Array.isArray(doc.cols)) return false;
    for (const [bid, cols] of Object.entries(doc.cols)) {
      const pre = MOVABLE[bid]; if (!pre) return false;
      if (!Array.isArray(cols) || cols.length !== 2 || !cols.every(Array.isArray)) return false;
      const ids = cols.flat();
      if (new Set(ids).size !== ids.length) return false;
      if (!ids.every(id => typeof id === "string" && id.startsWith(pre) && doc.items[id])) return false;
    }
  }
  return true;
}

export function digitalEditAllowed(before, after, canPrice) {
  if (!wellFormed(after)) return false;
  return locked(before, canPrice) === locked(after, canPrice);
}
