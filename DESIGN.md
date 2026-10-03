# App de Despesas — Design

A personal money tracker for the phone. Code is in English; everything the user sees is in Portuguese (pt-PT).

Runs as a static page (no build step, no server of our own). Data lives in **Supabase**, or in the browser's `localStorage` (only on a test server on this computer).

> Rewritten on 2026-10-03 to match the app as built. The first version (2026-09-25) was lost when the project folder moved into Git. Its decisions are kept below, each marked **kept**, **changed** or **not built yet**.

---

## Screens

| Screen | What it shows |
|---|---|
| **Entrar** | Email + password. Only with Supabase, only until this device has logged in once. |
| **Início** | Month selector · Total (bank + wallet) · Banco / Carteira · Entrou / Saiu · each main category with its total and 20 blocks, income first |
| **Movimentos** | Every movement, newest first, grouped by day with a day total. Same day + same category fold into one card. Filter chips per main category. Two-tap delete. |
| **Adicionar** | Expense or income · amount · Banco or Carteira · category → subcategory (create new ones inline) · "Editar" mode deletes categories |

**Not built yet:** Categoria detail screen, Simulação, a backup button, receipt reading.

---

## Data

### Movements (real money)

| field | example | notes |
|---|---|---|
| `id` | `"m_mg2k1x9a3f"` | unique |
| `date` | `"2026-09-03"` | `YYYY-MM-DD`, **local** date (never `toISOString()`, which is UTC) |
| `amount` | `420` | **whole cents**, always positive (4,20 €) |
| `type` | `"expense"` / `"income"` | decides the direction |
| `categoryId` | `"c_comboio"` | a subcategory, or a main category marked `noSubs` |
| `account` | `"bank"` / `"cash"` | missing on old movements → treated as `"bank"` |
| `receiptId` | `null` | reserved for receipt reading |
| `createdAt` | `1759412345678` | exact moment saved; orders movements within a day |

### Categories

| field | example | notes |
|---|---|---|
| `id` | `"c_alimentacao"` | unique |
| `name` | `"Alimentação"` | |
| `parentId` | `null` or `"c_alimentacao"` | `null` = main category |
| `type` | `"expense"` / `"income"` | |
| `color` | `"#1f3a22"` | main categories only; subcategories use their parent's |
| `archived` | `true` | deleted but still used by old movements |
| `noSubs` | `true` | skips the subcategory step (e.g. "Outros") |

### Balance (per account)

`{ bank: { amount, setAt } | null, cash: { amount, setAt } | null }` — a snapshot of the real balance and the moment it was set. The current balance is **computed**: snapshot + income − expenses added after `setAt`.

### Storage keys

| key | holds |
|---|---|
| `despesas.months` | index: `["2026-09", "2026-10"]` |
| `despesas.movements.2026-09` | that month's movements |
| `despesas.categories` | all categories |
| `despesas.balance` | the balance snapshots |
| `despesas.movements` | old single-document format; migrated on startup, then deleted |

---

## Decisions and why

### From the first design

1. **Changed — Claude artifact only → Supabase with login (2026-10-02).** Originally: an artifact, so receipt reading uses the Claude subscription and there is no hosting or login to manage. Now it runs on GitHub Pages with Supabase. The Claude storage path was removed from the code on 2026-10-03.
   *Why it changed:* the Claude subscription may not be renewed, and the app must not depend on Claude to keep working or to keep its data.
2. **Kept — plain JavaScript instead of React.** A small app doesn't need a framework. Limit already reached once: opening a folder now redraws only that folder, by hand, because redrawing the whole screen was too slow on the phone. If that keeps happening, it is the signal to reconsider.
3. **Kept — layers that never mix.** Now five files, each using only the ones loaded before it: `data` (reading, saving, login) → `logic` (pure calculations) → `watercolor` (drawing cache) → `screens` (drawing, taps) → `app` (start, tabs).
4. **Kept — money as whole cents.** `0.1 + 0.2` is `0.30000000000000004`; whole numbers are exact. Formatting to "4,20 €" happens only on screen.
5. **Kept — one list of movements with a `type` field.** A month's result is one pass over one list, like a bank statement.
6. **Kept — amounts always positive; `type` gives the direction.** One missing minus sign can't turn spending into income.
7. **Kept — categories inside categories via `parentId`.** One list covers both levels.
8. **Not built yet — receipts: AI suggests, user confirms.** AI mistakes never silently enter the totals.
   *Open question:* receipt reading relied on Claude, which decision 1 now rules out as a dependency. It needs another way to read receipts, or it stays unbuilt.
9. **Not built yet — simulation stored separately from real data**, so fake numbers can never leak into real totals.
10. **Not built yet — simulation v1: same income and spending every month.**
11. **Kept, and proven — storage behind one interface** (`load`, `save`, `remove`). Adding Supabase changed `data.js` and added a login screen; `logic.js` did not change at all.

### Added while building

12. **Two accounts, bank and cash.** The bank number must match the bank's app; cash is tracked separately. Total = both.
13. **Balance = snapshot + movements after it**, never a stored running total, so it can't drift if one save fails.
14. **One document per month, plus an index.** Originally forced by Claude's database (256 KB per document). Kept on Supabase because saving a movement only sends its month, not the whole history.
15. **Supabase used as a key-value store:** one table `store`, one row per (user, key), the value as JSON. Every backend holds exactly the same data, which made the move from Claude's database a straight copy. Trade-off: no SQL queries over movements.
16. **The Supabase key is public; protection is Row Level Security.** No server of our own, so the database itself must only return a logged-in user's own rows. **RLS on `store` must stay enabled.**
17. **Fail closed.** If the Supabase library doesn't load and this isn't `localhost`, show "Sem ligação à internet" instead of saving to the phone, where movements would silently never reach Supabase.
18. **Deleting a used category archives it.** Old movements keep their name, colour and totals; typing the name again brings it back.
19. **No date field.** A movement is stamped with the phone's local date and time when saved.
20. **Folders are display only.** Same day + same category become one card on screen; every movement stays separate in the data.
21. **Watercolour painted once and reused.** The live SVG filter cost ~0.5 s per tap on the phone; each patch is now painted once per colour and size into a picture.
22. **Two-tap delete, no pop-ups.** Originally because `confirm()` was blocked inside Claude's app; kept because it works the same on every device.

---

## Known gaps

- `Data.exportBackup` exists, but no button calls it, and there is no import/restore.
- `Data.setBalance` is not reachable from the screens, so a balance can't be corrected from the app.
- No automated tests. `logic.js` is pure and the easiest place to start.

## Not built yet (order not decided)

- Backup button + restore
- Tests for `logic.js`
- Categoria detail screen
- Simulação
- Receipt reading (decide first how it works outside Claude)
