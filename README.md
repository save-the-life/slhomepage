# savethelife.io

The SL Labs (Save the Life) website — [www.savethelife.io](https://www.savethelife.io/).

A dependency-free static site: no build step, no `package.json`, no framework. Open `index.html` in a browser and you are looking at production.

## Layout

```
index.html            Homepage
i18n.js               Homepage translations
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
> deployed domain, so it 404s locally. That is expected.

## Translations

The site ships in **7 languages** (en, ko, zh, ja, es, ru, vi).

English is the source of truth and lives **in the HTML itself**. Other locales
live in the three `*-i18n.js` packs and are swapped in at runtime:

- elements are marked `data-i18n="key"`
- language resolves as `?lang=xx` → `localStorage['sl-lang']` → `en`
- the `sl-lang` key is shared site-wide, so a language picked on the homepage
  carries into every sub-page without `?lang=` on the links

**Adding or changing a marked string means adding the key to all six locales.**
CI fails the build otherwise — a missing key silently renders that one element
in English, which is close to impossible to spot after deploy.

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
