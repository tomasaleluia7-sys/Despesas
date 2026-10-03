# Despesas

A personal expense tracker for the phone, built with plain HTML, CSS and JavaScript. No framework, no build step, no server.

The interface is in Portuguese (pt-PT).

## What it does

- **Two accounts:** bank and wallet (cash), each with its own balance, plus the total of both.
- **Movements:** every expense or income is stamped with the date and time it was added.
- **Categories and subcategories:** for example *Transportes › Comboio*. You can create new ones and delete old ones while adding a movement. Deleted categories that were already used are archived, so history and totals never break.
- **Monthly view:** money in, money out, and how much went to each category, drawn as 20 blocks per category.
- **Movements list:** grouped by day with a daily total. Repeated movements on the same day and in the same category fold into one card. Two-tap delete.

## Design

The "Master" look has three parts:

- an industrial Swiss grid (thin lines, monospace labels, square corners) on a black linen texture;
- a watercolour wash per category, drawn with an SVG `feTurbulence` / `feDisplacementMap` filter so the edges look hand-painted;
- a darker pool of pigment under each amount, so the numbers stay readable on top of the paint.

The filter is expensive on phones, so `js/watercolor.js` runs it once per colour and size and keeps the result as an image. Until an image is ready, the patch uses the live filter.

## How the code is organised

Five files, loaded in this order. Each one only uses the files loaded before it:

| File | Responsibility |
|---|---|
| `js/data.js` | Reading and saving. Knows where data lives; nothing about the screen. |
| `js/logic.js` | Pure calculations (money in cents, balances, totals, dates). No storage, no DOM. |
| `js/watercolor.js` | Paints each watercolour patch once into a picture and reuses it, so taps don't wait for the SVG filter. Screens don't call it; it watches the page. |
| `js/screens.js` | Draws each screen and reacts to taps. Reads and writes only through `Data`, asks `Logic` for every number. |
| `js/app.js` | Starts the app and switches between tabs. |

**Money is always stored as whole cents** (`420` = 4,20 €), so there are no floating-point rounding errors.

**Storage:** the app uses **Supabase** (on GitHub Pages or with `index.html` opened on the PC): one table `store` with a row per (user, key), protected by Row Level Security so a logged-in user only ever sees their own rows. The first time on a device it asks for email and password; after that it stays logged in. Movements are saved as one row per month, so no single row grows without limit.

## Run it

Open `index.html` in a browser, or serve the folder with any static server:

```bash
python3 -m http.server
```
