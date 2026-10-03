// WATERCOLOUR CACHE — makes the painted patches cheap to draw.
//
// The problem: every patch (category row, card, chip, button) used a live SVG filter
// (noise + displacement, see #wc-wash in index.html). The phone recalculates that filter
// every time the patch is drawn, and every tap rebuilds the screen → ~0.5 s of black.
//
// The fix: paint each patch ONCE into a picture (a bitmap), keep it in memory, and from then on
// just show the picture. Same colours, same filter, but the work happens once per
// colour + size instead of on every tap.
//
// How it plugs in: it watches the page. Whenever the screens add new patches, it measures
// them and either reuses a picture it already has (instant, before the phone even draws)
// or paints a new one in the background. Until the picture is ready, the patch keeps the
// live filter, so it never looks unpainted. Screens don't need to know this file exists.

const Watercolor = (() => {
  const PAD = 12; // the filter pushes edges outwards, so each picture gets a margin around the patch
  // Pictures are painted at normal size (not the phone's 2-3× pixels): the edges are soft anyway,
  // the text stays sharp because it isn't part of the picture, and it's ~4× less work.
  const SCALE = 1;
  const done = new Map();    // key → picture URL, ready to use
  const waiting = new Map(); // key → Promise, picture being painted

  // ---- Colours: the same color-mix() the CSS used, done in JavaScript ----
  const toRgb = (color) => {
    const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    const n = /rgba?\(([^)]+)\)/.exec(color);
    return n ? n[1].split(/[\s,]+/).slice(0, 3).map(Number) : null;
  };
  const mix = (rgb, other, otherShare) =>
    `rgb(${rgb.map((v, i) => Math.round(v * (1 - otherShare) + other[i] * otherShare)).join(",")})`;
  const WHITE = [255, 255, 255];
  const BLACK = [0, 0, 0];

  // Each kind of patch uses slightly different blobs of light and shadow (copied from style.css).
  // Positions are fractions of the patch: x 0.22 = 22% from the left.
  const RECIPES = {
    // Início rows: light blob, dark blob, plus a dark pool behind the amount on the right.
    cat: { light: [0.55, 0.95, 0.40, 0.28], dark: [0.45, 0.80, 0.70, 0.28], edge: 0.40, pool: true },
    // Adicionar: category cells and the Guardar button.
    wash: { light: [0.55, 0.95, 0.40, 0.28], dark: [0.45, 0.80, 0.70, 0.28], edge: 0.40, pool: false },
    // Movimentos: cards and chips (rounded).
    card: { light: [0.60, 0.90, 0.35, 0.28], dark: [0.55, 0.80, 0.70, 0.35], edge: 0.45, pool: false },
  };

  // Builds the SVG for one patch: the coloured shape with its blobs, inside the same filter as before.
  function buildSvg({ kind, color, wx, px, w, h, radius }) {
    const r = RECIPES[kind];
    const rgb = toRgb(color);
    const W = w + PAD * 2;
    const H = h + PAD * 2;
    const rx = Math.min(radius, h / 2, w / 2);
    // A radial blob: ellipse with radii (rw × w, rh × h) centred at (cx, cy), fading out at `end`.
    const blob = (id, rw, rh, cx, cy, stops) => `
      <radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1"
        gradientTransform="translate(${PAD + cx * w} ${PAD + cy * h}) scale(${rw * w} ${rh * h})">${stops}</radialGradient>`;
    const fade = (c, end) => `<stop offset="0" stop-color="${c}"/><stop offset="${end}" stop-color="${c}" stop-opacity="0"/>`;
    const lightC = mix(rgb, WHITE, r.light[3]);
    const darkC = mix(rgb, BLACK, r.dark[3]);
    const edgeC = mix(rgb, BLACK, r.edge);
    const shape = (fill, extra = "") =>
      `<rect x="${PAD}" y="${PAD}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${extra}/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}">
      <defs>
        ${blob("l", r.light[0], r.light[1], wx, r.light[2], fade(lightC, 0.7))}
        ${blob("d", r.dark[0], r.dark[1], px, r.dark[2], fade(darkC, 0.7))}
        ${r.pool ? blob("p", 0.34, 0.95, 0.90, 0.34,
          `<stop offset="0" stop-color="#060605" stop-opacity="0.78"/><stop offset="0.4" stop-color="#060605" stop-opacity="0.45"/><stop offset="0.78" stop-color="#060605" stop-opacity="0"/>`) : ""}
        <clipPath id="clip">${shape("#000")}</clipPath>
        <filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
        <filter id="wc" x="-8%" y="-25%" width="116%" height="150%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="2" seed="7" result="warp"/>
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="9" xChannelSelector="R" yChannelSelector="G" result="shape"/>
          <feMorphology in="shape" operator="erode" radius="2" result="inner"/>
          <feComposite in="shape" in2="inner" operator="out" result="ring"/>
          <feGaussianBlur in="ring" stdDeviation="1.8" result="ringSoft"/>
          <feColorMatrix in="ringSoft" type="matrix" values="0.82 0 0 0 0  0 0.82 0 0 0  0 0 0.82 0 0  0 0 0 0.55 0" result="rim"/>
          <feMerge><feMergeNode in="shape"/><feMergeNode in="rim"/></feMerge>
        </filter>
      </defs>
      <g filter="url(#wc)">
        ${shape(color)}
        ${shape("url(#d)")}
        ${shape("url(#l)")}
        ${r.pool ? shape("url(#p)") : ""}
        <g clip-path="url(#clip)">${shape("none", `stroke="${edgeC}" stroke-width="8" filter="url(#soft)"`)}</g>
      </g>
    </svg>`;
  }

  // SVG → bitmap. If the browser refuses to turn it into a bitmap, the SVG itself is used
  // (still cached, just a bit less fast).
  // data: URLs (not blob:) because the page already uses them for the linen texture, so every
  // place the app runs (GitHub Pages, a file on the PC) is known to allow them.
  async function paint(spec) {
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildSvg(spec))}`;
    try {
      const img = new Image();
      img.src = svgUrl;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return canvas.toDataURL("image/png");
    } catch {
      return svgUrl;
    }
  }

  // What a patch needs: which recipe, its colour, its blob positions, its size (rounded to 4 px,
  // so patches of almost the same size share one picture).
  function describe(el) {
    const isCard = el.classList.contains("wc");
    const style = getComputedStyle(el, isCard ? "::before" : null);
    const color = style.getPropertyValue("--c").trim();
    if (!toRgb(color)) return null; // "transparent" (no category) → nothing to paint
    const box = el.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) return null; // hidden right now → try again later
    const kind = isCard ? "card" : el.parentElement.classList.contains("cat") ? "cat" : "wash";
    const pct = (name, fallback) => (parseFloat(style.getPropertyValue(name)) || fallback) / 100;
    const defaults = { cat: [22, 60], wash: [22, 82], card: [25, 80] }[kind];
    const spec = {
      kind,
      color,
      wx: pct("--wx", defaults[0]),
      px: pct("--px", defaults[1]),
      w: Math.max(4, Math.round(box.width / 4) * 4),
      h: Math.max(4, Math.round(box.height / 4) * 4),
      radius: isCard ? parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 : 0,
    };
    spec.key = [spec.kind, spec.color, spec.wx, spec.px, spec.w, spec.h, spec.radius].join("|");
    return spec;
  }

  // New pictures are painted one at a time, with a pause between them, so the phone stays
  // free to react to taps while they're being made (painting one takes a few milliseconds).
  let queue = Promise.resolve();
  const breathe = () => new Promise((resolve) =>
    (window.requestIdleCallback ? requestIdleCallback(resolve, { timeout: 200 }) : setTimeout(resolve, 16)));
  const inTurn = (job) => {
    const result = queue.then(breathe).then(job);
    queue = result.catch(() => {});
    return result;
  };

  const apply = (el, url) => {
    el.style.setProperty("--baked", `url("${url}")`);
    el.classList.add("baked");
  };

  // One pass over the page: every patch that isn't a picture yet gets one.
  function pass() {
    const patches = document.querySelectorAll(".wash:not(.baked), .wc:not(.baked):not(.no-cat)");
    for (const el of patches) {
      const spec = describe(el);
      if (!spec) continue;
      if (done.has(spec.key)) {
        apply(el, done.get(spec.key)); // already painted → instant
        continue;
      }
      if (!waiting.has(spec.key)) {
        waiting.set(spec.key, inTurn(() => paint(spec)).then((url) => {
          done.set(spec.key, url);
          waiting.delete(spec.key);
          return url;
        }));
      }
      waiting.get(spec.key).then((url) => el.isConnected && apply(el, url));
    }
  }

  // Runs after the screens change the page, but before the phone draws it.
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; pass(); });
  };

  return {
    start() {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
      schedule();
    },
  };
})();
