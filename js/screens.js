// SCREENS LAYER — draws what the user sees and reacts to taps.
// Reads and writes only through Data, asks Logic for every calculation.
// Never touches localStorage directly.
//
// Look: "Master" — industrial grid (lines, mono labels, square corners) for Início and
// Adicionar, softer watercolour cards for Movimentos, all on black linen.

function escapeHtml(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(text).replace(/[&<>"']/g, (ch) => map[ch]);
}

// A painted wash behind some text. The colour is the main category's.
const wash = (color) => `<span class="wash" style="--c:${color}"></span>`;

// "1888,50 €" → ["1888", ",50 €"] so the cents can be drawn smaller (on the same line).
function splitMoney(cents) {
  const text = Logic.formatCents(cents).replace(/\s?€$/, "");
  const i = text.lastIndexOf(",");
  return [text.slice(0, i), `${text.slice(i)} €`];
}

const signed = (m) => `${m.type === "income" ? "+" : "−"}${Logic.formatCents(m.amount)}`;

// Small label on movements paid with cash, so they're easy to tell apart from bank ones.
function accountTag(m) {
  return Logic.accountOf(m) === "cash" ? `<span class="tag">Carteira</span>` : "";
}

const deleteButton = (m) => `<button class="del" data-delete="${m.id}" aria-label="Apagar">×</button>`;

// One movement as a watercolour card. The colour shows the main category, so the text only
// names the category itself ("Comboio", not "Transportes › Comboio"). The day is in the separator.
function movementCard(m, categories) {
  const color = Logic.categoryColor(categories, m.categoryId);
  return `
    <li class="wc mv ${color ? "" : "no-cat"}" style="--c:${color ?? "transparent"}">
      <span class="t">${m.createdAt ? Logic.timeOf(m.createdAt) : ""}</span>
      <span class="n"><span class="nt">${escapeHtml(Logic.findCategory(categories, m.categoryId)?.name ?? "Sem categoria")}</span>${accountTag(m)}</span>
      <span class="a">${signed(m)}</span>
      ${deleteButton(m)}
    </li>`;
}

// A folder of several movements (same day, same category): total + count badge.
// When open, it lists each movement with its time and amount.
function groupCard(g, categories) {
  const color = Logic.categoryColor(categories, g.categoryId);
  const name = Logic.findCategory(categories, g.categoryId)?.name ?? "Sem categoria";
  const isOpen = App.state.openGroups.has(g.key);
  const sign = g.type === "income" ? "+" : "−";
  const items = g.items.map((m) => `
      <li class="group-item">
        <span class="t">${m.createdAt ? Logic.timeOf(m.createdAt) : ""}${accountTag(m)}</span>
        <span class="a num">${signed(m)}</span>
        ${deleteButton(m)}
      </li>`).join("");
  return `
    <li class="wc ${color ? "" : "no-cat"}" style="--c:${color ?? "transparent"}">
      <button class="mv group-head" data-group="${g.key}" aria-expanded="${isOpen}">
        <span class="t"></span>
        <span class="n"><span class="nt">${escapeHtml(name)}</span><span class="count">${g.items.length}</span></span>
        <span class="a">${sign}${Logic.formatCents(g.total)}</span>
        <span class="chevron" aria-hidden="true">›</span>
      </button>
      ${isOpen ? `<ul class="group-items">${items}</ul>` : ""}
    </li>`;
}

// Delete in two taps, without browser pop-ups.
// 1st tap: × turns into a red "Apagar?". 2nd tap: deletes. No 2nd tap within 3 s: back to ×.
function wireDeleteButtons(root, screen) {
  root.querySelectorAll("[data-delete]").forEach((btn) => {
    let timer = null;
    btn.onclick = async (event) => {
      event.stopPropagation();
      if (!btn.classList.contains("confirming")) {
        btn.classList.add("confirming");
        btn.textContent = "Apagar?";
        timer = setTimeout(() => {
          btn.classList.remove("confirming");
          btn.textContent = "×";
        }, 3000);
        return;
      }
      clearTimeout(timer);
      btn.disabled = true;
      try {
        await Data.deleteMovement(btn.dataset.delete);
      } catch (error) {
        btn.disabled = false;
        btn.textContent = "Erro";
        return;
      }
      App.go(screen);
    };
  });
}

const Screens = {
  // ---- Entrar (only with Supabase, only until this phone has logged in once) ----
  // onDone runs after a successful login, when the data is already loaded.
  login(root, onDone) {
    root.innerHTML = `
      <div class="bar-top mono"><span>Despesas</span><span>Entrar</span></div>
      <form class="form" novalidate>
        <label class="mono" for="email">Email</label>
        <input id="email" class="input small" name="email" type="email" autocomplete="username" inputmode="email">
        <label class="mono" for="password">Palavra-passe</label>
        <input id="password" class="input small" name="password" type="password" autocomplete="current-password">
        <p class="error" hidden></p>
        <button type="submit" class="cta">${wash("var(--save)")}Entrar →</button>
      </form>
    `;
    const form = root.querySelector("form");
    const errorBox = form.querySelector(".error");
    const button = form.querySelector(".cta");

    form.onsubmit = async (event) => {
      event.preventDefault();
      const email = form.elements.email.value.trim();
      const password = form.elements.password.value;
      if (!email || !password) {
        errorBox.textContent = "Escreve o email e a palavra-passe.";
        errorBox.hidden = false;
        return;
      }
      if (button.disabled) return;
      button.disabled = true;
      button.lastChild.textContent = "A entrar…";
      errorBox.hidden = true;
      try {
        await Data.signIn(email, password);
      } catch (error) {
        button.disabled = false;
        button.lastChild.textContent = "Entrar →";
        errorBox.textContent = error.message;
        errorBox.hidden = false;
        return;
      }
      onDone();
    };
    form.elements.email.focus();
  },

  // ---- Início ----
  home(root) {
    const month = App.state.month;
    const movements = Data.getMovements();
    const categories = Data.getCategories();

    const summary = Logic.monthSummary(movements, month);
    // Income categories (Salário…) first, then expenses, each scaled against its own kind.
    const expenseTotals = Logic.totalsByTopCategory(movements, categories, month, "expense");
    const incomeTotals = Logic.totalsByTopCategory(movements, categories, month, "income");
    const balances = Logic.accountBalances(Data.getBalance(), movements);
    const money = (cents) => (cents === null ? "Por definir" : Logic.formatCents(cents));
    const neg = (cents) => (cents !== null && cents < 0 ? "neg" : "");

    // Total: big euros, smaller cents on the same baseline.
    const totalHtml = balances.total === null
      ? `<div class="big small">Por definir</div>`
      : (() => { const [eur, cents] = splitMoney(balances.total);
          return `<div class="big ${neg(balances.total)}">${eur}<span class="cents">${cents}</span></div>`; })();

    // 20 little blocks per category, filled in proportion to the biggest one of the same kind this month.
    const blocks = (total, max) => {
      const filled = Math.round((total / max) * 20);
      return Array.from({ length: 20 }, (_, i) => `<i class="${i < filled ? "f" : ""}"></i>`).join("");
    };
    // An income category with the same name as an expense one (e.g. "Outros") says so.
    const expenseNames = new Set(expenseTotals.map((t) => t.category.name.toLowerCase()));
    const rows = (totals, kind) => {
      const max = Math.max(1, ...totals.map((t) => t.total));
      return totals.map(({ category, total }) => {
        const name = kind === "income" && expenseNames.has(category.name.toLowerCase()) ? `${category.name} (entrada)` : category.name;
        return `
      <div class="cat ${kind} ${total === 0 ? "zero" : ""}">${wash(Logic.categoryColor(categories, category.id))}
        <span class="n">${escapeHtml(name)}</span><span class="amt num">${total === 0 ? "" : kind === "income" ? "+" : "−"}${Logic.formatCents(total)}</span>
        <span class="blocks">${blocks(total, max)}</span>
      </div>`;
      }).join("");
    };
    const categoryRows = rows(incomeTotals, "income") + rows(expenseTotals, "expense"); // income (Salário) on top

    root.innerHTML = `
      <div class="bar-top mono">
        <span>Despesas</span>
        <div class="month-nav">
          <button data-action="prev" aria-label="Mês anterior">‹</button>
          <span>${Logic.monthLabel(month)}</span>
          <button data-action="next" aria-label="Mês seguinte">›</button>
        </div>
      </div>

      <section class="total"><div class="mono label">Total</div>${totalHtml}</section>

      <div class="grid2">
        <div><div class="mono">Banco</div><div class="v num ${neg(balances.bank)}">${money(balances.bank)}</div></div>
        <div><div class="mono">Carteira</div><div class="v num ${neg(balances.cash)}">${money(balances.cash)}</div></div>
      </div>
      <div class="grid2">
        <div><div class="mono">Entrou</div><div class="v in num">${Logic.formatCents(summary.income)}</div></div>
        <div><div class="mono">Saiu</div><div class="v out num">${Logic.formatCents(summary.expense)}</div></div>
      </div>

      <section>${categoryRows}</section>

    `;

    root.querySelector('[data-action="prev"]').onclick = () => {
      App.state.month = Logic.shiftMonth(month, -1);
      App.go("home");
    };
    root.querySelector('[data-action="next"]').onclick = () => {
      App.state.month = Logic.shiftMonth(month, 1);
      App.go("home");
    };
  },

  // ---- Movimentos: grouped by day, newest first ----
  movements(root) {
    const categories = Data.getCategories();
    const filter = App.state.filter; // top-level category id, or null = all
    const all = Logic.newestFirst(Data.getMovements());
    const shown = filter ? all.filter((m) => Logic.topLevelId(categories, m.categoryId) === filter) : all;
    const today = Logic.todayISO();

    // Expense categories first, then income. If both have one with the same name (e.g. "Outros"),
    // the income one says so, otherwise the two chips would look identical.
    const expenseMains = Logic.mainCategories(categories, "expense");
    const expenseNames = new Set(expenseMains.map((c) => c.name.toLowerCase()));
    const chipLabel = (c) => (c.type === "income" && expenseNames.has(c.name.toLowerCase()) ? `${c.name} (entrada)` : c.name);
    const chips = expenseMains.concat(Logic.mainCategories(categories, "income")).map((c) => `
      <button class="wc chip ${filter === c.id ? "active" : ""}" data-filter="${c.id}"
              style="--c:${Logic.categoryColor(categories, c.id)}">${escapeHtml(chipLabel(c))}</button>`).join("");

    // One block per day: a separator (name + day total), then that day's cards.
    // Inside a day, same-category movements become a folder.
    const days = [];
    for (const m of shown) {
      if (!days.length || days.at(-1).date !== m.date) days.push({ date: m.date, items: [] });
      days.at(-1).items.push(m);
    }
    const groupsByKey = new Map(); // so a folder can be redrawn on its own when tapped
    const dayBlocks = days.map((d) => {
      const net = d.items.reduce((t, m) => t + (m.type === "income" ? m.amount : -m.amount), 0);
      const groups = Logic.groupSameDay(d.items);
      groups.forEach((g) => groupsByKey.set(g.key, g));
      const cards = groups.map((g) =>
        g.items.length === 1 ? movementCard(g.items[0], categories) : groupCard(g, categories)).join("");
      return `
        <div class="daysep mono"><span>${Logic.dayLabel(d.date, today)}</span><span class="tot num">${net >= 0 ? "+" : "−"}${Logic.formatCents(Math.abs(net))}</span></div>
        <ul class="cards">${cards}</ul>`;
    }).join("");

    root.innerHTML = `
      <div class="bar-top mono"><span>Movimentos</span></div>
      <div class="std">
        <div class="chips ${filter ? "filtering" : ""}">
          <button class="chip chip-all ${filter ? "" : "active"}" data-filter="">Todas</button>
          ${chips}
        </div>
        ${shown.length ? dayBlocks : `
          <div class="empty-state">
            <p class="empty-title">${filter ? "Nada nesta categoria ainda" : "Ainda não há movimentos"}</p>
            <p class="empty-text">Cada despesa ou entrada que guardares aparece aqui, a mais recente primeiro.</p>
            <button class="btn-line" data-go="add">Adicionar movimento</button>
          </div>`}
      </div>
    `;

    root.querySelector("[data-go]")?.addEventListener("click", () => App.go("add"));

    // Tapping a folder opens/closes it. Remembered in App.state so it stays open after a delete.
    // Only THAT folder is redrawn (not the whole screen): the old card is swapped for a new one.
    const wireGroup = (head) => {
      head.onclick = () => {
        const key = head.dataset.group;
        const open = App.state.openGroups;
        open.has(key) ? open.delete(key) : open.add(key);
        const card = head.closest("li");
        card.insertAdjacentHTML("afterend", groupCard(groupsByKey.get(key), categories));
        const fresh = card.nextElementSibling;
        card.remove();
        wireGroup(fresh.querySelector("[data-group]"));
        wireDeleteButtons(fresh, "movements");
      };
    };
    root.querySelectorAll("[data-group]").forEach(wireGroup);

    root.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.onclick = () => {
        App.state.filter = btn.dataset.filter || null;
        App.go("movements");
      };
    });
    wireDeleteButtons(root, "movements");
  },

  // ---- Adicionar ----
  add(root) {
    let type = "expense";
    let account = "bank";
    let categoryId = null; // a main category id, or NEW
    let subId = null;      // a subcategory id, or NEW, or null for noSubs categories
    let editing = false;   // "Editar" mode: tapping a category asks to delete it
    const NEW = "__new";
    const today = Logic.todayISO();

    root.innerHTML = `
      <div class="bar-top mono"><span>Novo movimento</span><span>${today.slice(8, 10)}.${today.slice(5, 7)}</span></div>
      <form class="form" novalidate>
        <div class="seg" role="group" aria-label="Tipo">
          <button type="button" data-type="expense" class="on">Despesa</button>
          <button type="button" data-type="income">Entrada</button>
        </div>

        <label class="mono" for="amount">Valor (€)</label>
        <input id="amount" class="input" name="amount" inputmode="decimal" placeholder="0,00" autocomplete="off">

        <div class="seg" role="group" aria-label="De onde sai o dinheiro">
          <button type="button" data-account="bank" class="on">Banco</button>
          <button type="button" data-account="cash">Carteira</button>
        </div>

        <div class="label-row"><span class="mono">Categoria</span><button type="button" class="edit-toggle mono" data-edit>Editar</button></div>
        <p class="edit-hint mono" hidden>Toca duas vezes numa categoria para a apagar. Os movimentos antigos não se perdem.</p>
        <div class="paint" data-cats></div>
        <input id="newCategory" class="input small" name="newCategory" placeholder="Nome da nova categoria" autocomplete="off" hidden>

        <div data-sub-field>
          <span class="mono">Subcategoria</span>
          <div class="seg multi" data-subs style="margin-top: 12px"></div>
        </div>
        <input id="newSub" class="input small" name="newSub" placeholder="Nome da nova subcategoria" autocomplete="off" hidden>

        <p class="error" hidden></p>
        <button type="submit" class="cta">${wash("var(--save)")}Guardar →</button>
      </form>
    `;

    const form = root.querySelector("form");
    const { amount: amountInput, newCategory: newCategoryInput, newSub: newSubInput } = form.elements;
    const catsBox = form.querySelector("[data-cats]");
    const subsBox = form.querySelector("[data-subs]");
    const subField = form.querySelector("[data-sub-field]");
    const errorBox = form.querySelector(".error");

    // Two-tap delete for a category cell (only in "Editar" mode). 1st tap: red "Apagar?".
    // 2nd tap within 3 s: delete. Movements that used it are kept (see Data.deleteCategory).
    const wireDelete = (btn, id) => {
      let timer = null;
      btn.onclick = async () => {
        if (!btn.classList.contains("confirming")) {
          btn.classList.add("confirming");
          timer = setTimeout(() => btn.classList.remove("confirming"), 3000);
          return;
        }
        clearTimeout(timer);
        btn.disabled = true;
        try {
          await Data.deleteCategory(id);
        } catch (error) {
          btn.disabled = false;
          btn.classList.remove("confirming");
          return showError(`Não foi possível apagar (código: ${error?.code || error?.message || "desconhecido"}).`);
        }
        drawCategories();
      };
    };

    form.querySelector("[data-edit]").onclick = (event) => {
      editing = !editing;
      event.currentTarget.textContent = editing ? "Concluir" : "Editar";
      event.currentTarget.classList.toggle("on", editing);
      form.querySelector(".edit-hint").hidden = !editing;
      form.classList.toggle("editing", editing);
      drawCategories();
    };

    // Step 1: main categories of the chosen type as painted cells, plus "+ Nova".
    const drawCategories = () => {
      const categories = Data.getCategories();
      const mains = Logic.mainCategories(categories, type);
      if (!mains.some((c) => c.id === categoryId) && categoryId !== NEW) categoryId = mains[0]?.id ?? NEW;
      catsBox.innerHTML = mains.map((c) => `
        <button type="button" data-cat="${c.id}" class="${c.id === categoryId && !editing ? "on" : ""}">${wash(Logic.categoryColor(categories, c.id))}${escapeHtml(c.name)}</button>`).join("")
        + (editing ? "" : `<button type="button" data-cat="${NEW}" class="new ${categoryId === NEW ? "on" : ""}">+ Nova</button>`);
      catsBox.querySelectorAll("[data-cat]").forEach((b) => {
        if (editing) return wireDelete(b, b.dataset.cat);
        b.onclick = () => {
          categoryId = b.dataset.cat;
          subId = null;
          drawCategories();
          if (categoryId === NEW) newCategoryInput.focus();
        };
      });
      newCategoryInput.hidden = categoryId !== NEW || editing;
      drawSubcategories();
    };

    // Step 2: subcategories of that category, plus "+ Nova". There is no "none": every movement
    // goes into a subcategory, except categories marked noSubs (e.g. "Outros"), which skip this step.
    const drawSubcategories = () => {
      const categories = Data.getCategories();
      const parent = Logic.findCategory(categories, categoryId);
      const noSubs = Boolean(parent?.noSubs);
      subField.hidden = noSubs;
      if (noSubs) { subId = null; newSubInput.hidden = true; return; }
      const subs = categoryId === NEW ? [] : Logic.subcategories(categories, categoryId);
      if (!subs.some((c) => c.id === subId) && subId !== NEW) subId = subs[0]?.id ?? NEW;
      subField.hidden = editing && subs.length === 0;
      subsBox.innerHTML = subs.map((c) => `
        <button type="button" data-sub="${c.id}" class="${c.id === subId && !editing ? "on" : ""}">${escapeHtml(c.name)}</button>`).join("")
        + (editing ? "" : `<button type="button" data-sub="${NEW}" class="${subId === NEW ? "on" : ""}">+ Nova</button>`);
      subsBox.querySelectorAll("[data-sub]").forEach((b) => {
        if (editing) return wireDelete(b, b.dataset.sub);
        b.onclick = () => {
          subId = b.dataset.sub;
          drawSubcategories();
          if (subId === NEW) newSubInput.focus();
        };
      });
      newSubInput.hidden = subId !== NEW || editing;
    };

    form.querySelectorAll("[data-type]").forEach((btn) => {
      btn.onclick = () => {
        type = btn.dataset.type;
        form.querySelectorAll("[data-type]").forEach((b) => b.classList.toggle("on", b === btn));
        categoryId = null;
        subId = null;
        drawCategories();
      };
    });

    form.querySelectorAll("[data-account]").forEach((btn) => {
      btn.onclick = () => {
        account = btn.dataset.account;
        form.querySelectorAll("[data-account]").forEach((b) => b.classList.toggle("on", b === btn));
      };
    });

    drawCategories();

    const showError = (message) => {
      errorBox.textContent = message;
      errorBox.hidden = false;
    };

    form.onsubmit = async (event) => {
      event.preventDefault();
      const amount = Logic.parseCents(amountInput.value);
      // No date field: the movement is stamped with the phone's date and time right now.
      const date = Logic.todayISO();

      if (editing) return showError("Toca em Concluir antes de guardar.");
      if (!amount) return showError("Introduz um valor válido, por exemplo 4,20.");
      if (categoryId === NEW && !newCategoryInput.value.trim()) return showError("Escreve o nome da nova categoria.");
      if (subId === NEW && !newSubInput.value.trim()) return showError("Escreve o nome da nova subcategoria.");

      // Show that something is happening, and never fail silently:
      // if saving errors or takes too long (bad connection), say so and let the user retry.
      const button = form.querySelector(".cta");
      if (button.disabled) return; // already saving — ignore a double tap
      button.disabled = true;
      button.lastChild.textContent = "A guardar…";
      errorBox.hidden = true;
      try {
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 10000));
        // Create the new category/subcategory first (if any), then the movement inside it.
        const save = async () => {
          let target = categoryId;
          if (target === NEW) {
            const created = await Data.addCategory({
              name: newCategoryInput.value, parentId: null, type,
              color: Logic.nextFreeColor(Data.getCategories()),
            });
            target = created.id;
          }
          if (subId === NEW) {
            target = (await Data.addCategory({ name: newSubInput.value, parentId: target, type })).id;
          } else if (subId) {
            target = subId; // null only for noSubs categories → stays in the main one
          }
          await Data.addMovement({ date, amount, type, account, categoryId: target });
        };
        await Promise.race([save(), timeout]);
      } catch (error) {
        console.error(error);
        button.disabled = false;
        button.lastChild.textContent = "Guardar →";
        const code = error?.code || error?.message || "desconhecido";
        return showError(`Não foi possível guardar (código: ${code}). Recarrega a página e tenta outra vez.`);
      }
      App.state.month = Logic.monthKey(date);
      App.go("home");
    };

    amountInput.focus();
  },
};
