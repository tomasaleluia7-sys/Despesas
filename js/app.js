// APP — starts everything and switches between screens.

const SCREEN_TITLES = {
  home: "Início",
  movements: "Movimentos",
  add: "Adicionar",
};

const App = {
  // UI state shared between screens (not saved).
  state: {
    month: null, // "YYYY-MM" shown on Início
    filter: null, // category id chosen on Movimentos (null = all)
    openGroups: new Set(), // folders currently open on Movimentos ("date|category|type")
  },

  current: null,

  go(screen) {
    const switching = screen !== this.current;
    this.current = screen;
    document.title = `Despesas · ${SCREEN_TITLES[screen]}`;
    document.querySelectorAll(".tabbar [data-screen]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.screen === screen);
    });
    const root = document.getElementById("app");
    root.removeAttribute("aria-busy");
    Screens[screen](root);
    // Content rises in only when you change tab, not after every save/delete (that would feel jumpy).
    if (switching) {
      root.classList.remove("enter");
      void root.offsetWidth; // restart the animation
      root.classList.add("enter");
      window.scrollTo(0, 0);
    }
  },

  async start() {
    await Data.init();
    this.state.month = Logic.monthKey(Logic.todayISO());
    document.querySelectorAll(".tabbar [data-screen]").forEach((btn) => {
      btn.onclick = () => this.go(btn.dataset.screen);
    });
    this.go("home");
  },
};

App.start();
