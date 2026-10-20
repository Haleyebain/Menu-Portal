/* Menu Portal: session, gate, shared storage adapter and the small portal bar.
 *
 * One door: login.html. Every other page calls PORTAL.gate(bucket) before it
 * shows anything. The access code is the credential; the cached audience and
 * buckets are only a memory of the last sign-in, refreshed from /api/access on
 * every page load. A code that stops working signs the person out.
 */
(function () {
  "use strict";
  var KEYS = ["portal_email", "portal_key", "portal_aud", "portal_label", "portal_ent"];
  function get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function here() {
    var f = (location.pathname.split("/").pop() || "").split("?")[0].split("#")[0];
    if (!f) f = "index.html";
    if (f.indexOf(".") < 0) f += ".html";   /* Netlify serves pretty URLs; never match a raw href */
    return f;
  }
  function toLogin() {
    var next = here();
    location.replace("login.html" + (next && next !== "index.html" ? "?next=" + encodeURIComponent(next) : ""));
  }
  function signOut() {
    KEYS.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    location.replace("login.html");
  }
  function session() {
    var ent = null; try { ent = JSON.parse(get("portal_ent") || "null"); } catch (e) {}
    return { email: get("portal_email"), key: get("portal_key"), audience: get("portal_aud"), label: get("portal_label"), ent: ent };
  }

  /* Ask the server who this code is. Resolves the entitlements, or null when the code is not valid. */
  function check(key) {
    return fetch("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: key }), cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) return null;
        return r.json().then(function (j) {
          if (!r.ok) { var e = new Error(j.detail || "Access could not be checked."); e.unavailable = true; throw e; }
          return j;
        });
      });
  }
  function remember(email, key, ent) {
    set("portal_email", email); set("portal_key", key);
    set("portal_aud", ent.audience || ""); set("portal_label", ent.label || "");
    set("portal_ent", JSON.stringify(ent));
  }
  function has(ent, bucket) { return !!(ent && ent.buckets && ent.buckets.some(function (b) { return b.id === bucket; })); }

  function blocked(title, text) {
    document.body.innerHTML =
      '<main style="max-width:560px;margin:14vh auto;padding:0 20px;font:15px/1.6 system-ui,sans-serif;color:#1E2730">' +
      '<h1 style="font-size:24px;margin:0 0 10px">' + title + '</h1><p style="margin:0 0 18px;color:#5F6A75">' + text + '</p>' +
      '<p><a href="index.html">Back to your tools</a> &nbsp;·&nbsp; <a href="#" id="pbOut">Sign out</a></p></main>';
    document.getElementById("pbOut").addEventListener("click", function (e) { e.preventDefault(); signOut(); });
  }

  /* gate(bucket): resolves the session when this code may open the bucket.
     Signs out on a dead code, shows a plain message on a bucket not granted. */
  function gate(bucket) {
    var s = session();
    if (!s.key) { toLogin(); return new Promise(function () {}); }
    return check(s.key).then(function (ent) {
      if (!ent) { signOut(); return new Promise(function () {}); }
      remember(s.email, s.key, ent);
      s.ent = ent; s.audience = ent.audience; s.label = ent.label;
      if (bucket && !has(ent, bucket)) {
        blocked("Not part of your access", "Your access code does not include this tool. Ask the person who issued your code if you need it.");
        return new Promise(function () {});
      }
      return s;
    }, function (err) {
      /* the access sheet is briefly down: keep working from the last sign-in rather than locking everyone out */
      if (s.ent && (!bucket || has(s.ent, bucket))) return s;
      blocked("Access can’t be checked right now", (err && err.message) || "Try again in a minute.");
      return new Promise(function () {});
    });
  }

  /* ---------- shared storage, the same shape the studios already use ---------- */
  function api(path, opts) {
    opts = opts || {};
    var s = session();
    var headers = { "x-access-key": s.key, "x-portal-email": encodeURIComponent(s.email || "") };
    if (opts.body) headers["content-type"] = "application/json";
    if (opts.restore) headers["x-restore"] = "1";
    return fetch(path, { method: opts.method || "GET", headers: headers, body: opts.body, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) { signOut(); throw { code: "revoked", message: "Signed out" }; }
        if (r.status === 403) throw { code: "invalid_argument", message: "Your access does not include this menu" };
        if (r.status === 413) throw { code: "quota_exceeded", message: "Too large to save" };
        if (!r.ok) throw { code: r.status >= 500 ? "unavailable" : "bad_request", message: "Request failed (" + r.status + ")" };
        return r.json();
      }, function () { throw { code: "unavailable", message: "Network error" }; });
  }
  function db(bucket) {
    var base = "/api/store/" + encodeURIComponent(bucket) + "/";
    var snapOf = function (docs) { return { docs: docs.map(function (d) { return { id: d.id, exists: true, data: function () { return d.data; } }; }) }; };
    var watchers = [];
    function poll(w) {
      if (w.busy) return; w.busy = true;
      api(base + w.coll).then(function (j) { w.fn(snapOf(j.docs)); }, function (e) { if (w.err && e && e.code !== "unavailable") w.err(e); })
        .then(function () { w.busy = false; });
    }
    setInterval(function () { if (!document.hidden) watchers.forEach(poll); }, 15000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) watchers.forEach(poll); });
    function collection(coll) {
      var c = {
        onSnapshot: function (fn, err) { var w = { coll: coll, fn: fn, err: err }; watchers.push(w); poll(w); return function () { watchers.splice(watchers.indexOf(w), 1); }; },
        get: function () { return api(base + coll).then(function (j) { return snapOf(j.docs); }); },
        where: function (field, op, value) {
          return { get: function () { return api(base + coll).then(function (j) {
            return snapOf(j.docs.filter(function (d) { var v = d.data && d.data[field]; return op === "==" ? v === value : op === "!=" ? v !== value : true; }));
          }); } };
        },
        doc: function (id) {
          return {
            set: function (data, o) { return api(base + coll + "/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(data), restore: o && o.restore }).then(function () {
              watchers.forEach(function (w) { if (w.coll === coll) setTimeout(function () { poll(w); }, 400); });
            }); },
            delete: function () { return api(base + coll + "/" + encodeURIComponent(id), { method: "DELETE" }); },
          };
        },
      };
      return c;
    }
    return {
      collection: collection,
      refresh: function () { watchers.forEach(poll); },
      history: {
        menus: function () { return api(base + "versions").then(function (j) { return j.menus; }); },
        versions: function (id) { return api(base + "versions/" + encodeURIComponent(id)).then(function (j) { return j.versions; }); },
        get: function (id, ver) { return api(base + "versions/" + encodeURIComponent(id) + "/" + encodeURIComponent(ver)); },
      },
    };
  }

  /* ---------- the portal bar: a way home and a way out, added to a studio's own top bar ---------- */
  function bar(s) {
    var top = document.querySelector("header.top") || document.querySelector(".top");
    if (!top || document.getElementById("portalHome")) return;
    var css = document.createElement("style");
    css.textContent = ".pb-home{display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:inherit;font-size:13px;padding:6px 10px 6px 6px;border-radius:6px;border:1px solid var(--line,#D6DBE0);white-space:nowrap}" +
      ".pb-home:hover{background:var(--panel-2,#F6F7F8)}.pb-home svg{width:15px;height:15px}" +
      ".pb-user{font-size:12px;color:var(--muted,#5F6A75);white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}" +
      ".pb-out{font:inherit;font-size:12px;background:none;border:0;color:var(--muted,#5F6A75);text-decoration:underline;cursor:pointer;padding:4px}";
    document.head.appendChild(css);
    var home = document.createElement("a");
    home.id = "portalHome"; home.className = "pb-home"; home.href = "index.html";
    home.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 6-6 6 6 6"/></svg>All tools';
    top.insertBefore(home, top.firstChild);
    var who = document.createElement("span"); who.className = "pb-user"; who.textContent = s.email || s.label || "";
    who.title = (s.label ? s.label + " · " : "") + (s.email || "");
    var out = document.createElement("button"); out.className = "pb-out"; out.type = "button"; out.textContent = "Sign out";
    out.addEventListener("click", signOut);
    top.appendChild(who); top.appendChild(out);
  }

  window.PORTAL = { gate: gate, check: check, remember: remember, session: session, signOut: signOut, db: db, bar: bar, has: has, here: here };
})();
