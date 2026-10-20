# Menu Portal

Sign in once with a work email and an access code. The code decides which
buckets (tools) and which restaurants a person sees.

Buckets today:
- **Wine Lists** (`wine-lists.html`): wine and spirits lists for Sam's, Alpin Room and The Cabin.
- **Special Menus** (`special-menus.html`): group, event and seasonal menus, including Cloud Nine, plus a locked "Today’s Special" sign for The Cabin, Elk Camp, Up 4 Pizza, Two Creeks Café, Cliffhouse and Backyard (only the title, description and price change).
- **Basic Signage** (`signage.html`): simple brand signs (Whitney Bold title, Nantes sub head) in three templates: portrait 8.5 × 11, landscape 11 × 8.5, and four 4.25 × 5.5 signs on one 8.5 × 11 sheet. Signs are shared across properties: anyone whose code includes `signage` can open and edit every sign.

Built on the Sales Studio pattern from the Menu Portal handoff kit: one door,
the code is the credential, access lives in a Google Sheet, no codes in shipped
files. The look of `login.html` and `index.html` is a neutral placeholder; the
portal's visual design comes later and lives in `portal.css`.

## How it fits together

```
login.html            the only door: email + access code
index.html            home: one tile per bucket the code grants
wine-lists.html       Wine List Studio, reading and saving through the portal
special-menus.html    Special Menus Studio, reading and saving through the portal
portal.js             session, page gate, storage adapter, the "All tools / Sign out" bar
portal.css            placeholder styles for the door and home page

netlify/functions/access.mjs      POST /api/access  -> what a code may open
netlify/functions/store.mjs       /api/store/<bucket>/...  shared menus and version history (Netlify Blobs)
netlify/functions/_lib/access.mjs resolves a code from the Access sheet (or ACCESS_CODES)
apps-script/Code.gs               the Access sheet feed
data/wine-seed.json               the wine lists as they are today, loaded on first use
```

Every storage call carries the code. The server, not the browser, decides what
comes back and what can be saved: a Sam's code never receives The Cabin's
menus, and a save to a menu outside its restaurants is refused.

## Access codes

One row per person or group in the **Access** tab of a private Google Sheet:

| Audience | Key | Label | Buckets | Properties | Active |
|---|---|---|---|---|---|
| F&B Leadership | (a code) | All venues | all | all | ☑ |
| Sam's Somm | (a code) | Sam's | wine-lists, special-menus | sams | ☑ |
| Cabin Wine | (a code) | The Cabin | wine-lists | cabin | ☑ |

- **Buckets:** `all`, or any of `wine-lists`, `special-menus`, `signage`
- **Properties:** `all`, or any of `sams`, `alpin`, `cabin`, `c9`, `elk`, `up4`, `twocreeks`, `cliffhouse`, `backyard` (full names such as `Elk Camp` or `Two Creeks Café` also work)
- **Active:** untick to switch a code off. Changes take effect within a minute, no deploy.

Codes compare without case. Unknown words in a cell are ignored, never guessed.

## Set up

1. **Sheet and feed.** Create a private Google Sheet. In the Sheet, choose
   Extensions, Apps Script, and paste `apps-script/Code.gs` (leave `SHEET_ID` empty).
   Deploy as a web app, Execute as: Me, Who has access: Anyone. Open
   `<exec-url>?setup=1` once to create the Access tab, then replace the two example codes.
2. **Netlify site.** Put this folder in a Git repo and import it in Netlify
   (Add new site, Import an existing project). No build command.
   Or from this folder: `npm install`, then `netlify deploy --prod`.
3. **Environment variable.** Site configuration, Environment variables:
   `ACCESS_FEED_URL` = the Apps Script `/exec` URL. Redeploy once.

Before the Sheet exists you can start with `ACCESS_CODES` instead, a JSON value:
`{"PICK-A-CODE":{"audience":"F&B Leadership","label":"All venues","buckets":"all","properties":"all"}}`.
`ACCESS_FEED_URL` wins when both are set.

Drag-and-drop deploys and Netlify Drop ship static files only. The portal needs
its functions, so deploy from Git or the CLI.

## Check a deploy

- Every page title ends in the build tag (`· b1015a`). If the tab shows an older tag, the deploy did not land.
- `POST /api/access` with a wrong code must answer `401 {"error":"invalid_key"}`. That proves the door reached the Access sheet and refused a fake code.
- `<exec-url>?key=WRONGCODE` must answer `{"__error":"invalid_key"}`.

## Adding a bucket later

1. Add the page and have it call `PORTAL.gate("<bucket-id>")` and `PORTAL.db("<bucket-id>")`.
2. Add the id to `BUCKETS` in `netlify/functions/_lib/access.mjs` and `COLLECTIONS` in `store.mjs`.
3. Add a tile in `index.html`. Then tick it for the right people in the Access sheet.

## Safety net

Each save of a menu keeps the version it replaced (at most one per 10 minutes of
continuous editing, and always before a restore or delete; 300 per menu). Wine
Lists: Menu settings, Version history. Special Menus: History.
