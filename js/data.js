// DATA LAYER — reading and saving.
// Knows nothing about the screen or about totals.

// The only place that knows where data physically lives. Two possible places:
// - Normally (GitHub Pages, opened from the PC) → Supabase, after logging in.
// - A test server on this computer without the Supabase library → the browser's localStorage.
// Every place offers the same three operations: load, save, remove a value by its key.

// Supabase project. Both values are meant to be public: the key only lets a request in,
// and the database's own rules (Row Level Security) only show a logged-in user their own rows.
const SUPABASE_URL = "https://mgncijddkyolzlrlphrp.supabase.co";
const SUPABASE_KEY = "sb_publishable__-_rTACXw6nscunR4xg91Q_YRNb1Y7j";

const localBackend = {
  async load(key) {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  },
  async save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  async remove(key) {
    localStorage.removeItem(key);
  },
};

// Supabase: one table "store" with a row per (user, key). The value column holds the same
// JSON the other backends hold. Supabase returns { data, error } instead of throwing,
// so each call turns an error into a thrown one (the screens already show thrown errors).
function supabaseBackend(client, userId) {
  const check = ({ data, error }) => {
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data;
  };
  return {
    async load(key) {
      const row = check(await client.from("store").select("value").eq("key", key).maybeSingle());
      return row ? row.value : null;
    },
    async save(key, value) {
      check(await client.from("store").upsert(
        { user_id: userId, key, value, updated_at: new Date().toISOString() },
        { onConflict: "user_id,key" },
      ));
    },
    async remove(key) {
      check(await client.from("store").delete().eq("key", key));
    },
  };
}

const storage = {
  _backend: null,
  _client: null, // the Supabase connection, when Supabase is used

  // Decides once, at startup, which backend to use.
  // Returns false when Supabase is used but nobody is logged in yet (the app shows the login).
  async init() {
    if (!window.supabase) {
      // Library didn't load. Only on a test server on this computer is it OK to use the
      // browser's storage; anywhere else that would save to the wrong place, so stop instead.
      if (!["localhost", "127.0.0.1"].includes(location.hostname)) {
        throw new Error("Sem ligação à internet. Fecha a app e abre outra vez quando tiveres rede.");
      }
      this._backend = localBackend;
      return true;
    }
    // The library remembers the login on this phone and renews it by itself,
    // so after the first login this finds the session straight away.
    this._client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data } = await this._client.auth.getSession();
    if (!data.session) return false;
    this._backend = supabaseBackend(this._client, data.session.user.id);
    return true;
  },

  // Email + password login. Throws with a message for the screen if it fails.
  async signIn(email, password) {
    const { data, error } = await this._client.auth.signInWithPassword({ email, password });
    if (error) {
      throw new Error(error.message === "Invalid login credentials"
        ? "Email ou palavra-passe errados."
        : `Não foi possível entrar (${error.message}).`);
    }
    this._backend = supabaseBackend(this._client, data.user.id);
  },
  load(key) {
    return this._backend.load(key);
  },
  remove(key) {
    return this._backend.remove(key);
  },
  // Retries once after a short pause if the database reports a temporary problem.
  async save(key, value) {
    try {
      return await this._backend.save(key, value);
    } catch (error) {
      if (error?.code !== "unavailable") throw error;
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
      return this._backend.save(key, value);
    }
  },
};

// Movements are split into ONE DOCUMENT PER MONTH ("despesas.movements.2026-09"),
// so saving only sends that month's movements, not the whole history.
// "despesas.months" is the index: the list of months that have a document.
const KEYS = {
  legacyMovements: "despesas.movements", // old format: everything in one document
  months: "despesas.months",
  movementsOf: (month) => `despesas.movements.${month}`,
  categories: "despesas.categories",
  balance: "despesas.balance",
};

const DEFAULT_CATEGORIES = [
  // Deep, dark watercolour pigments: forest green, navy, burnt umber, dark violet, deep teal, wine red.
  { id: "c_alimentacao", name: "Alimentação", parentId: null, type: "expense", color: "#1f3a22" },
  { id: "c_carro", name: "Carro", parentId: null, type: "expense", color: "#18294a" },
  { id: "c_combustivel", name: "Combustível", parentId: null, type: "expense", color: "#4f2812" },
  { id: "c_transportes", name: "Transportes", parentId: null, type: "expense", color: "#4a3a10" },
  // Subcategories: no colour of their own, they use their parent's.
  { id: "c_cantina_uni", name: "Cantina Uni", parentId: "c_alimentacao", type: "expense" },
  { id: "c_comboio", name: "Comboio", parentId: "c_transportes", type: "expense" },
  { id: "c_salario", name: "Salário", parentId: null, type: "income", color: "#2b2a52" },
  { id: "c_outros", name: "Outros", parentId: null, type: "income", color: "#4f1623" },
];

// Hands a file to the user as a normal browser download.
async function saveFile(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { status: "saved" };
}

// The balance is kept per ACCOUNT: "bank" (must match the bank app) and "cash" (coins/notes).
// Each one is a snapshot { amount, setAt }; movements added after setAt move it up or down.
// Old format was a single { amount, date, setAt } → it becomes the bank account.
const ACCOUNTS = ["bank", "cash"];
function normalizeBalance(raw) {
  if (!raw) return { bank: null, cash: null };
  if ("bank" in raw || "cash" in raw) return { bank: raw.bank ?? null, cash: raw.cash ?? null };
  return { bank: { amount: raw.amount, setAt: raw.setAt }, cash: null };
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const Data = {
  _movements: [],
  _categories: [],
  // { bank: {amount, setAt} | null, cash: {amount, setAt} | null }
  _balance: { bank: null, cash: null },

  // Months that already have a document, e.g. ["2026-09", "2026-10"].
  _months: [],

  // Returns false when a login is needed first (then call signIn, which loads the data).
  async init() {
    if (!(await storage.init())) return false;
    await this._load();
    return true;
  },

  async signIn(email, password) {
    await storage.signIn(email, password);
    await this._load();
  },

  async _load() {
    await this._migrateLegacyMovements();
    this._months = (await storage.load(KEYS.months)) ?? [];
    // Load every month in parallel and join them into one flat list for Logic.
    const perMonth = await Promise.all(this._months.map((m) => storage.load(KEYS.movementsOf(m))));
    this._movements = perMonth.flatMap((list) => list ?? []);
    this._categories = (await storage.load(KEYS.categories)) ?? structuredClone(DEFAULT_CATEGORIES);
    this._balance = normalizeBalance(await storage.load(KEYS.balance));
  },

  // One-off move from the old single document to one document per month.
  // Safe to run again if it was interrupted: it merges by id and deletes the
  // old document only after every month has been saved.
  async _migrateLegacyMovements() {
    const legacy = await storage.load(KEYS.legacyMovements);
    if (!legacy) return;

    const byMonth = new Map();
    for (const m of legacy) {
      const month = m.date.slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month).push(m);
    }

    const months = new Set((await storage.load(KEYS.months)) ?? []);
    for (const [month, list] of byMonth) {
      const existing = (await storage.load(KEYS.movementsOf(month))) ?? [];
      const ids = new Set(existing.map((m) => m.id));
      await storage.save(KEYS.movementsOf(month), [...existing, ...list.filter((m) => !ids.has(m.id))]);
      months.add(month);
    }
    await storage.save(KEYS.months, [...months].sort());
    await storage.remove(KEYS.legacyMovements);
  },

  // Saves one month's document, and adds the month to the index the first time.
  async _saveMonth(month, list) {
    await storage.save(KEYS.movementsOf(month), list);
    if (!this._months.includes(month)) {
      const months = [...this._months, month].sort();
      await storage.save(KEYS.months, months);
      this._months = months;
    }
  },

  // Everything needed to rebuild the app somewhere else, in one plain JSON file.
  async exportBackup(todayISO) {
    const backup = {
      app: "despesas",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      balance: this._balance,
      categories: this._categories,
      movements: [...this._movements].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    };
    return saveFile(`despesas-backup-${todayISO}.json`, JSON.stringify(backup, null, 2));
  },

  // Creates a category (parentId null) or a subcategory (parentId = its main category).
  // If one with the same name already exists in the same place, that one is reused.
  async addCategory({ name, parentId = null, type, color = null }) {
    const clean = String(name).trim().replace(/\s+/g, " ");
    if (!clean) throw new Error("Empty category name");
    const same = this._categories.find((c) =>
      c.type === type && c.parentId === parentId && c.name.toLowerCase() === clean.toLowerCase());
    if (same && !same.archived) return same;
    if (same) {
      // Typed again after being archived → bring it back into the lists.
      const next = this._categories.map((c) => (c.id === same.id ? { ...c, archived: false } : c));
      await storage.save(KEYS.categories, next);
      this._categories = next;
      return next.find((c) => c.id === same.id);
    }

    const category = { id: newId("c"), name: clean, parentId, type };
    if (parentId === null && color) category.color = color; // subcategories use the parent's colour
    const next = [...this._categories, category];
    await storage.save(KEYS.categories, next);
    this._categories = next;
    return category;
  },

  // Deletes a category or subcategory (a main category takes its subcategories with it).
  // Never loses history: a category that some movement uses is only ARCHIVED (hidden from the
  // lists, but old movements keep their name, colour and totals). Unused ones are removed for good.
  async deleteCategory(id) {
    const ids = new Set([id, ...this._categories.filter((c) => c.parentId === id).map((c) => c.id)]);
    const used = new Set(this._movements.map((m) => m.categoryId));
    const childUsed = this._categories.some((c) => c.parentId === id && used.has(c.id));
    const next = this._categories
      .filter((c) => !ids.has(c.id) || used.has(c.id) || (c.id === id && childUsed))
      .map((c) => (ids.has(c.id) ? { ...c, archived: true } : c));
    await storage.save(KEYS.categories, next);
    this._categories = next;
  },

  getMovements() {
    return this._movements;
  },

  getCategories() {
    return this._categories;
  },

  getBalance() {
    return this._balance;
  },

  // Sets one account's balance to what the user sees right now (not used by the screens yet).
  async setBalance(account, amount) {
    if (!ACCOUNTS.includes(account)) throw new Error(`Invalid account: ${account}`);
    if (!Number.isInteger(amount)) throw new Error(`Invalid balance: ${amount}`);
    const next = { ...this._balance, [account]: { amount, setAt: Date.now() } };
    await storage.save(KEYS.balance, next);
    this._balance = next;
  },

  async addMovement({ date, amount, type, categoryId, account = "bank", receiptId = null }) {
    // Last line of defence: bad money never reaches storage.
    if (!Number.isInteger(amount) || amount <= 0) throw new Error(`Invalid amount: ${amount}`);
    if (type !== "expense" && type !== "income") throw new Error(`Invalid type: ${type}`);
    if (!ACCOUNTS.includes(account)) throw new Error(`Invalid account: ${account}`);

    const movement = { id: newId("m"), date, amount, type, categoryId, account, receiptId, createdAt: Date.now() };
    const month = date.slice(0, 7);
    const monthList = [...this._movements.filter((m) => m.date.startsWith(month)), movement];
    await this._saveMonth(month, monthList); // if this throws, memory stays unchanged → no duplicates on retry
    this._movements = [...this._movements, movement];
    return movement;
  },

  async deleteMovement(id) {
    const target = this._movements.find((m) => m.id === id);
    if (!target) return;
    const month = target.date.slice(0, 7);
    const next = this._movements.filter((m) => m.id !== id);
    await this._saveMonth(month, next.filter((m) => m.date.startsWith(month)));
    this._movements = next;
  },
};
