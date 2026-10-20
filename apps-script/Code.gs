/**
 * Menu Portal access feed.
 *
 * Reads the Access tab of a private Google Sheet and answers one question for
 * the portal: what may this access code open?
 *
 *   GET <exec-url>?key=CODE   -> { "__meta": { audience, label, entitlements: { buckets, properties } } }
 *                                or { "__error": "invalid_key" }
 *   GET <exec-url>?setup=1    -> creates the Access tab with headers and two example rows, once.
 *
 * Access tab, one row per person or group, headers in row 1:
 *   Audience | Key | Label | Buckets | Properties | Active
 *   F&B Leadership | (a code) | All venues | all | all | TRUE
 *   Sam's Somm     | (a code) | Sam's      | wine-lists, special-menus | sams | TRUE
 *
 *   Buckets:    all, or any of  wine-lists, special-menus, signage
 *   Properties: all, or any of  sams, alpin, cabin, c9, elk, up4, twocreeks, cliffhouse, backyard
 *   Active:     untick to switch a code off without deleting the row (blank counts as on)
 *
 * Easiest: open the Sheet, Extensions, Apps Script, paste this file. No ID needed.
 * Or a standalone Apps Script project with the Sheet ID pasted below.
 * Deploy, New deployment, Web app, Execute as: Me, Who has access: Anyone.
 * Copy the /exec URL into Netlify as the ACCESS_FEED_URL environment variable.
 * Updating later: Deploy, Manage deployments, pencil, Version: New version, Deploy.
 * Proof it works: <exec-url>?key=WRONGCODE must answer {"__error":"invalid_key"}.
 */
var SHEET_ID = "";   // leave empty when this script was opened from the Sheet (Extensions, Apps Script)

/* The Sheet: the one this script belongs to, or the one named by SHEET_ID. */
function book() {
  var id = String(SHEET_ID || "").trim();
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Open this script from the Sheet (Extensions, Apps Script) or paste the Sheet ID into SHEET_ID.");
  return ss;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  var out = p.setup === "1" ? setupAccess() : lookup(String(p.key || ""));
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function lookup(key) {
  key = key.trim().toUpperCase();
  if (!key) return { __error: "invalid_key" };
  var sh = book().getSheetByName("Access");
  if (!sh) return { __error: "no_access_tab" };
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return { __error: "invalid_key" };
  var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var col = function (name) { return head.indexOf(name); };
  var cK = col("key"), cA = col("audience"), cL = col("label"), cB = col("buckets"), cP = col("properties"), cOn = col("active");
  if (cK < 0) return { __error: "no_key_column" };
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (String(r[cK]).trim().toUpperCase() !== key) continue;
    if (cOn >= 0 && r[cOn] === false) return { __error: "invalid_key" };
    return { __meta: {
      audience: cA >= 0 ? String(r[cA]).trim() : "Team",
      label: cL >= 0 ? String(r[cL]).trim() : "",
      entitlements: {
        buckets: cB >= 0 ? String(r[cB]).trim() : "",
        properties: cP >= 0 ? String(r[cP]).trim() : ""
      }
    } };
  }
  return { __error: "invalid_key" };
}

function setupAccess() {
  var ss = book();
  if (ss.getSheetByName("Access")) return { __setup: "exists" };
  var sh = ss.insertSheet("Access");
  sh.getRange(1, 1, 1, 6).setValues([["Audience", "Key", "Label", "Buckets", "Properties", "Active"]]).setFontWeight("bold");
  sh.getRange(2, 1, 2, 6).setValues([
    ["F&B Leadership", "CHANGE-ME-1", "All venues", "all", "all", true],
    ["Sam's Somm", "CHANGE-ME-2", "Sam's", "wine-lists, special-menus", "sams", true]
  ]);
  sh.getRange(2, 6, 2, 1).insertCheckboxes();
  sh.setFrozenRows(1);
  return { __setup: "created" };
}
