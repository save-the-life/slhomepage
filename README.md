# savethelife.io

The SL Labs (Save the Life) website — [www.savethelife.io](https://www.savethelife.io/).

A dependency-free static site: no build step, no `package.json`, no framework. Open `index.html` in a browser and you are looking at production. The one server-side piece is a single Vercel function that forwards presale applications (see below).

## Layout

```
index.html            Homepage
i18n.js               Homepage translations
launchpad.html        Launchpad — $SL presale application + IR video & deck (/launchpad, /ir, /presale)
launchpad-i18n.js       + its translations
ir/                   IR assets: video (MP4 + poster), deck (PDF + per-slide JPEGs)
api/apply.js          Vercel function behind the presale application form
products/             Protocol networks — Pet Tooth AI, MediReport, SL Watch
  products-i18n.js      + their translations
apps/                 Live apps — HealthFi, Thor, Lucky Dice, Health Hero
  apps-i18n.js          + their translations
img/  images/         Assets
scripts/verify.mjs    Pre-deploy checks (see below)
```

## Running it locally

```bash
python -m http.server 8000     # or any static file server
```

Then open <http://localhost:8000>. Nothing to install or compile.

> Note: Vercel Analytics (`/_vercel/insights/script.js`) only resolves on the
> deployed domain, so it 404s locally. That is expected. `/api/apply` also only
> exists on Vercel (`vercel dev` runs it locally); on a plain static server the
> form shows its e-mail fallback.

## Translations

The site ships in **7 languages** (en, ko, zh, ja, es, ru, vi).

English is the source of truth and lives **in the HTML itself**. Other locales
live in the four `*-i18n.js` packs and are swapped in at runtime:

- elements are marked `data-i18n="key"`
- language resolves as `?lang=xx` → `localStorage['sl-lang']` → `en`
- the `sl-lang` key is shared site-wide, so a language picked on the homepage
  carries into every sub-page without `?lang=` on the links

**Adding or changing a marked string means adding the key to all six locales.**
CI fails the build otherwise — a missing key silently renders that one element
in English, which is close to impossible to spot after deploy.

## Launchpad application form

`launchpad.html` posts the form as JSON to `/api/apply`, which validates it
(eligibility, wallet format, consents, honeypot) and forwards it to the team.
Nothing is stored on Vercel. Configure at least one sink in the Vercel project's
environment variables:

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | One message per application in a team chat (create a bot with @BotFather, add it to the chat) |
| `SHEETS_WEBHOOK_URL` | POST of the JSON record to a Google Apps Script web app that appends a row to a Sheet |

Until one is set the endpoint answers `503` and the page offers a prefilled
e-mail to partners@savethelife.io instead. Restricted jurisdictions (KR, US, CN
and comprehensively sanctioned countries) are refused both in the page and in
the function; the visitor's IP country (`x-vercel-ip-country`) is attached to
each record for the team's review.

To swap in a hosted form (e.g. a Typeform/Tally page), set `embedUrl` in the
`CFG` object at the top of the page script — the native form is replaced by an
iframe. Ambassador links look like `/launchpad?ref=CODE`; the code is captured
into the form and into the record.

Minimal Apps Script for the Sheets sink:

```js
function doPost(e) {
  const r = JSON.parse(e.postData.contents);
  SpreadsheetApp.getActiveSheet().appendRow([r.receivedAt, r.id, r.name, r.email, r.telegram,
    r.country, r.ipCountry, r.wallet, r.amount, r.source, r.ref, r.ambassadorId, r.note, r.lang]);
  return ContentService.createTextOutput('ok');
}
```

## Checks

```bash
node scripts/verify.mjs
```

Plain Node, no dependencies, runs in seconds. Covers markup balance, internal
links and images, JSON-LD validity, the analytics tag, i18n key coverage across
every page and locale, inline-tag balance inside translation strings, and
sitemap entries.

## How it ships

`main` is protected. Open a pull request; **Verify static site** must pass
before it merges. Merging to `main` triggers a production deployment through
Vercel's Git integration — CI never deploys, or every push would deploy twice.

## Licence / use

Content and brand assets belong to SL Labs. The source is public for
transparency, not as a template to re-publish.
