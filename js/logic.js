// LOGIC LAYER — calculations only.
// Every function takes plain values and returns plain values:
// no storage, no DOM. That makes each one easy to test in the console.

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

// Used for categories created later that don't have a colour of their own
// (muted brick, dark ochre, indigo, dark cerulean, olive, plum).
const FALLBACK_COLORS = ["#4a2b2b", "#4d3a10", "#242656", "#173a52", "#333b16", "#3f1733"];

const euroFormat = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });

const Logic = {
  // ---- Money ----

  // "4,20" / "4.20" / "4,2 €" / "1.234,56" → whole cents, or null if unreadable.
  // Never goes through a float, so there is no rounding error.
  parseCents(text) {
    let s = String(text).trim().replace(/[€\s]/g, "");
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!match) return null;
    const euros = Number(match[1]);
    const cents = Number((match[2] ?? "").padEnd(2, "0"));
    return euros * 100 + cents;
  },

  // Same as parseCents, but a leading "-" is allowed (an overdrawn account).
  parseSignedCents(text) {
    const s = String(text).trim();
    const negative = /^[-−]/.test(s);
    const cents = this.parseCents(negative ? s.slice(1) : s);
    if (cents === null) return null;
    return negative ? -cents : cents;
  },

  // 420 → "4,20 €". Dividing is fine here: it is only for display.
  formatCents(cents) {
    return euroFormat.format(cents / 100);
  },

  // ---- Dates ----

  // Local date, not toISOString() (that one is UTC and can be off by a day).
  todayISO() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  },

  // "2026-09-03" → "2026-09"
  monthKey(date) {
    return date.slice(0, 7);
  },

  // ("2026-01", -1) → "2025-12"
  shiftMonth(month, delta) {
    const [y, m] = month.split("-").map(Number);
    const index = y * 12 + (m - 1) + delta;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  },

  // "2026-09" → "Setembro 2026"
  monthLabel(month) {
    const [y, m] = month.split("-").map(Number);
    const name = MONTH_NAMES[m - 1];
    return `${name[0].toUpperCase()}${name.slice(1)} ${y}`;
  },

  // "2026-09-03" → "3 set"
  shortDate(date) {
    const [, m, d] = date.split("-").map(Number);
    return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
  },

  // Day separators: "Hoje, 1 out", "Ontem, 30 set", or just "29 set".
  dayLabel(date, today) {
    const dayNumber = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
    const diff = dayNumber(today) - dayNumber(date);
    const short = this.shortDate(date);
    if (diff === 0) return `Hoje, ${short}`;
    if (diff === 1) return `Ontem, ${short}`;
    return short;
  },

  // Timestamp → "14:32" (the phone's local time).
  timeOf(timestamp) {
    const d = new Date(timestamp);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  },

  // ---- Movements ----

  // Every movement, newest first (by day, then by the exact moment it was saved).
  newestFirst(movements) {
    return [...movements].sort((a, b) =>
      b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  },

  // Folders for the Movimentos tab: movements on the SAME DAY in the SAME category
  // become one group. Only for display — every movement stays separate in the data.
  // Input must already be newest first; the output keeps that order.
  // → [{ key, date, categoryId, type, items: [...], total }]  (items.length 1 = a normal movement)
  groupSameDay(movements) {
    const groups = new Map();
    for (const m of movements) {
      const key = `${m.date}|${m.categoryId}|${m.type}`;
      if (!groups.has(key)) {
        groups.set(key, { key, date: m.date, categoryId: m.categoryId, type: m.type, items: [], total: 0 });
      }
      const group = groups.get(key);
      group.items.push(m);
      group.total += m.amount;
    }
    return [...groups.values()];
  },

  movementsInMonth(movements, month) {
    return movements.filter((m) => this.monthKey(m.date) === month);
  },

  // One pass over one list, like a bank statement.
  monthSummary(movements, month) {
    let income = 0;
    let expense = 0;
    for (const m of this.movementsInMonth(movements, month)) {
      if (m.type === "income") income += m.amount;
      else expense += m.amount;
    }
    return { income, expense, saved: income - expense };
  },

  // ---- Balance ----

  // Was this movement added after the balance was set? Both carry the exact moment
  // they were saved, so one comparison is enough. Old movements (no createdAt) → before.
  isAfterSnapshot(movement, balance) {
    return (movement.createdAt ?? 0) > balance.setAt;
  },

  // Which account a movement used. Movements from before the split have none → bank.
  accountOf(movement) {
    return movement.account ?? "bank";
  },

  // For each account: its snapshot + what came in − what went out after it.
  // Total = bank + cash. An account never set up shows as null (not 0).
  // → { bank: 206099, cash: 960, total: 207059 }
  accountBalances(balance, movements) {
    const calc = (account) => {
      const snap = balance?.[account];
      if (!snap) return null;
      let total = snap.amount;
      for (const m of movements) {
        if (this.accountOf(m) !== account || !this.isAfterSnapshot(m, snap)) continue;
        total += m.type === "income" ? m.amount : -m.amount;
      }
      return total;
    };
    const bank = calc("bank");
    const cash = calc("cash");
    const total = bank === null && cash === null ? null : (bank ?? 0) + (cash ?? 0);
    return { bank, cash, total };
  },

  // ---- Categories ----

  findCategory(categories, id) {
    return categories.find((c) => c.id === id) ?? null;
  },

  // Walks up parentId until reaching a top-level category.
  topLevelId(categories, categoryId) {
    let current = this.findCategory(categories, categoryId);
    for (let guard = 0; current && current.parentId && guard < 20; guard++) {
      current = this.findCategory(categories, current.parentId);
    }
    return current ? current.id : null;
  },

  // Colour of a category = colour of its top-level parent, so "Ovos" is green like "Alimentação".
  categoryColor(categories, categoryId) {
    const top = this.findCategory(categories, this.topLevelId(categories, categoryId));
    if (!top) return null;
    if (top.color) return top.color;
    const index = categories.filter((c) => c.parentId === null).indexOf(top);
    return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  },

  // Main categories of one type ("expense"/"income"), in the order they were created.
  // Archived ones are left out of the pickers, but old movements still show and count them.
  mainCategories(categories, type) {
    return categories.filter((c) => c.parentId === null && c.type === type && !c.archived);
  },

  // Subcategories of one main category (archived ones left out, same reason).
  subcategories(categories, parentId) {
    return categories.filter((c) => c.parentId === parentId && !c.archived);
  },

  // Colour for a NEW main category: the first dark pigment nobody is using yet.
  nextFreeColor(categories) {
    const used = new Set(categories.map((c) => c.color).filter(Boolean));
    return FALLBACK_COLORS.find((col) => !used.has(col)) ?? FALLBACK_COLORS[categories.length % FALLBACK_COLORS.length];
  },

  // "Alimentação › Ovos"
  categoryPath(categories, categoryId) {
    const names = [];
    let current = this.findCategory(categories, categoryId);
    for (let guard = 0; current && guard < 20; guard++) {
      names.unshift(current.name);
      current = current.parentId ? this.findCategory(categories, current.parentId) : null;
    }
    return names.length ? names.join(" › ") : "Sem categoria";
  },

  // Totals per top-level category (subcategories roll up into their parent).
  // Includes categories with 0, biggest first.
  totalsByTopCategory(movements, categories, month, type) {
    // Active categories always show (even at 0). Deleted (archived) ones only show
    // in a month where they still have movements, so the totals keep adding up.
    const totals = new Map(
      categories.filter((c) => c.parentId === null && c.type === type && !c.archived).map((c) => [c.id, 0])
    );
    for (const m of this.movementsInMonth(movements, month)) {
      if (m.type !== type) continue;
      const topId = this.topLevelId(categories, m.categoryId);
      if (!topId) continue;
      totals.set(topId, (totals.get(topId) ?? 0) + m.amount);
    }
    return [...totals]
      .map(([id, total]) => ({ category: this.findCategory(categories, id), total }))
      .sort((a, b) => b.total - a.total);
  },

  // Flat list for a <select>: each parent followed by its children, with depth.
  categoryOptions(categories, type) {
    const result = [];
    const addWithChildren = (parentId, depth) => {
      for (const c of categories.filter((c) => c.type === type && c.parentId === parentId)) {
        result.push({ category: c, depth });
        addWithChildren(c.id, depth + 1);
      }
    };
    addWithChildren(null, 0);
    return result;
  },
};
