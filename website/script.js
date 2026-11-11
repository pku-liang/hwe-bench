const VERSIONS = [
  { id: "v1.1", file: "scores-v1.1.json", note: "November 2026 · 208 tasks revised", notes: "v1.1.html" },
  { id: "v1.0", file: "scores-v1.0.json", note: "Original release · April–July 2026" },
];

const state = { version: VERSIONS[0].id, agent: "All", sortKey: null, sortDir: -1, display: "pct", view: "rank" };
const scoresByVersion = {};

const GROUP_LABELS = { proprietary: "Proprietary", "open-source": "Open-Source" };
const DISPLAY_MODES = [
  ["pct", "Percentage"],
  ["count", "Count"],
];
const VIEW_MODES = [
  ["rank", "By rank"],
  ["type", "By type"],
];

function pct(part, total) {
  return (part / total) * 100;
}

function fmtPct(part, total) {
  return pct(part, total).toFixed(1);
}

function fmtCost(cost) {
  return cost.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const VENDOR_ICONS = {
  openai: '<svg viewBox="0 0 24 24"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>',
  anthropic: '<svg viewBox="0 0 24 24"><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"/></svg>',
  qwen: '<svg viewBox="0 0 24 24"><path d="M23.919 14.545 20.817 9.17l1.47-2.544a.56.56 0 0 0 0-.566l-1.633-2.83a.57.57 0 0 0-.49-.283h-6.207L12.487.402a.57.57 0 0 0-.49-.284H8.732a.56.56 0 0 0-.49.284L5.139 5.775h-2.94a.56.56 0 0 0-.49.284L.077 8.887a.56.56 0 0 0 0 .567L3.18 14.83l-1.47 2.545a.56.56 0 0 0 0 .566l1.634 2.83a.57.57 0 0 0 .49.283h6.205l1.47 2.545a.57.57 0 0 0 .49.284h3.266a.57.57 0 0 0 .49-.284l3.104-5.375h2.94a.57.57 0 0 0 .49-.283l1.634-2.828a.55.55 0 0 0-.004-.568M8.733.686l1.634 2.828-1.634 2.828H21.8L20.164 9.17H7.425L5.63 6.06Zm1.306 19.801-6.205-.002 1.634-2.83h3.265L2.201 6.344h3.267q3.182 5.517 6.367 11.032zm10.124-5.66L18.53 12l-6.532 11.315-1.634-2.83c2.129-3.673 4.25-7.351 6.373-11.028h3.592l3.102 5.374z"/></svg>',
  deepseek: '<svg viewBox="0 0 24 24"><path d="M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45"/></svg>',
  moonshot: '<svg viewBox="0 0 24 24"><path d="M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z"/><path d="M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z"/></svg>',
  zhipu: '<svg viewBox="0 0 30 30"><path d="M24.51,28.51H5.49c-2.21,0-4-1.79-4-4V5.49c0-2.21,1.79-4,4-4h19.03c2.21,0,4,1.79,4,4v19.03C28.51,26.72,26.72,28.51,24.51,28.51z" fill="currentColor"/><path d="M15.47,7.1l-1.3,1.85c-0.2,0.29-0.54,0.47-0.9,0.47h-7.1V7.09C6.16,7.1,15.47,7.1,15.47,7.1z" fill="#FFFFFF"/><polygon points="24.3,7.1 13.14,22.91 5.7,22.91 16.86,7.1" fill="#FFFFFF"/><path d="M14.53,22.91l1.31-1.86c0.2-0.29,0.54-0.47,0.9-0.47h7.09v2.33H14.53z" fill="#FFFFFF"/></svg>',
};

function nameWithEffort(parent, m) {
  parent.appendChild(el("span", "model-label", m.name));
  if (m.effort) parent.appendChild(el("span", "effort", `(${m.effort})`));
}

function sortedByOverall(models) {
  return [...models].sort((a, b) => b.overall - a.overall);
}

function renderStats(data) {
  document.getElementById("stat-models").textContent = String(data.models.length);
  const top = sortedByOverall(data.models)[0];
  document.getElementById("stat-top").textContent = `${fmtPct(top.overall, data.benchmark.total)}%`;
  document.getElementById("stat-cases").textContent = String(data.benchmark.total);
}

function renderChart(data) {
  const chart = document.getElementById("chart");
  chart.textContent = "";
  const models = sortedByOverall(data.models).filter(
    (m) => state.agent === "All" || m.agent === state.agent
  );
  for (const m of models) {
    const row = el("div", "chart-row");
    const label = el("div", "chart-label");
    nameWithEffort(label, m);
    if (VENDOR_ICONS[m.vendor]) {
      const icon = el("span", "vendor-icon");
      icon.innerHTML = VENDOR_ICONS[m.vendor];
      label.appendChild(icon);
    }
    row.appendChild(label);
    const track = el("div", "chart-track");
    const bar = el("div", `chart-bar ${m.group}`);
    bar.style.width = `${pct(m.overall, data.benchmark.total)}%`;
    track.appendChild(bar);
    row.appendChild(track);
    row.appendChild(
      el("div", "chart-value", `${fmtPct(m.overall, data.benchmark.total)}% · ${m.overall}/${data.benchmark.total}`)
    );
    chart.appendChild(row);
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// Label positions tried around each dot, in order: [dx, dy, text-anchor].
const LABEL_SPOTS = [
  [9, 4, "start"], [-9, 4, "end"], [0, -12, "middle"], [0, 21, "middle"],
  [7, -8, "start"], [-7, -8, "end"], [7, 18, "start"], [-7, 18, "end"],
];

// Cost against resolved rate in the style of Artificial Analysis: log-scale cost, the cheaper-and-better
// quadrant (split at the medians) shaded. Axes and quadrant come from every model of the version, so they
// stay put when the scaffold filter hides points.
function renderScatter(data) {
  const box = document.getElementById("scatter");
  box.textContent = "";
  const total = data.benchmark.total;
  document.getElementById("scatter-note").textContent =
    `${state.version} · Cost of one run over all ${total} tasks at standard list prices`;

  const all = data.models;
  const shown = sortedByOverall(all).filter((m) => state.agent === "All" || m.agent === state.agent);
  const W = box.clientWidth;
  const narrow = W < 560;
  const H = narrow ? 340 : 440;
  const pad = { top: 12, right: 16, bottom: 48, left: 58 };
  const right = W - pad.right;
  const bottom = H - pad.bottom;

  const logs = all.map((m) => Math.log10(m.costs));
  const x0 = Math.min(...logs) - 0.2;
  const x1 = Math.max(...logs) + 0.2;
  const x = (cost) => pad.left + ((Math.log10(cost) - x0) / (x1 - x0)) * (right - pad.left);
  const rates = all.map((m) => pct(m.overall, total));
  const span = Math.max(...rates) - Math.min(...rates);
  const step = span > 25 ? 10 : 5;
  const padY = Math.max(1, span * 0.06);
  const y0 = Math.min(...rates) - padY;
  const y1 = Math.min(100, Math.max(...rates) + padY);
  const y = (rate) => pad.top + ((y1 - rate) / (y1 - y0)) * (bottom - pad.top);

  const svg = svgEl("svg", {
    width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "group",
    "aria-label": "Scatter plot of resolved rate against total cost by model",
  }, box);

  const qx = x(median(all.map((m) => m.costs)));
  const qy = y(median(rates));
  svgEl("rect", { x: pad.left, y: pad.top, width: qx - pad.left, height: qy - pad.top, class: "sc-quadrant" }, svg);

  // Point labels may run into the left margin, but not over the y-axis title or tick labels.
  const obstacles = [];
  svgEl("line", { x1: pad.left, x2: right, y1: bottom, y2: bottom, class: "sc-grid" }, svg);
  for (let t = Math.ceil(y0 / step) * step; t <= y1; t += step) {
    svgEl("line", { x1: pad.left, x2: right, y1: y(t), y2: y(t), class: "sc-grid" }, svg);
    const tick = svgEl("text", { x: pad.left - 8, y: y(t) + 3.5, "text-anchor": "end", class: "sc-tick" }, svg);
    tick.textContent = `${t}%`;
    obstacles.push(tick.getBBox());
  }
  for (let e = Math.floor(x0); e <= Math.ceil(x1); e++) {
    for (const k of narrow ? [1, 3] : [1, 2, 5]) {
      const v = k * 10 ** e;
      if (Math.log10(v) < x0 || Math.log10(v) > x1) continue;
      svgEl("line", { x1: x(v), x2: x(v), y1: pad.top, y2: bottom, class: "sc-grid" }, svg);
      svgEl("text", { x: x(v), y: bottom + 16, "text-anchor": "middle", class: "sc-tick" }, svg).textContent =
        v >= 1000 ? `$${v / 1000}K` : `$${v}`;
    }
  }
  svgEl("text", { x: (pad.left + right) / 2, y: H - 6, "text-anchor": "middle", class: "sc-axis" }, svg).textContent =
    "Total cost (USD, log scale)";
  const yTitle = svgEl("text", {
    x: -(pad.top + bottom) / 2, y: 14, transform: "rotate(-90)", "text-anchor": "middle", class: "sc-axis",
  }, svg);
  yTitle.textContent = "Resolved rate";
  const titleLength = yTitle.getComputedTextLength();
  obstacles.push({ x: 0, y: (pad.top + bottom - titleLength) / 2, width: 20, height: titleLength });

  const qLabel = svgEl("text", { x: pad.left + 8, y: pad.top + 17, class: "sc-quadrant-label" }, svg);
  qLabel.textContent = "Most attractive quadrant";
  const qBox = qLabel.getBBox();
  if (qBox.x + qBox.width > qx - 6 || qBox.y + qBox.height > qy) qLabel.remove();
  else obstacles.push(qBox);

  const tip = el("div", "sc-tip");
  const hideTip = () => tip.classList.remove("visible");
  const points = shown.map((m) => ({ m, cx: x(m.costs), cy: y(pct(m.overall, total)) }));
  for (const p of points) {
    obstacles.push({ x: p.cx - 6, y: p.cy - 6, width: 12, height: 12 });
    const g = svgEl("g", {
      class: `sc-point ${p.m.group}`, tabindex: 0,
      "aria-label": `${p.m.name}: ${fmtPct(p.m.overall, total)}% resolved, ${fmtCost(p.m.costs)}`,
    }, svg);
    svgEl("circle", { cx: p.cx, cy: p.cy, r: 12, class: "sc-hit" }, g);
    svgEl("circle", { cx: p.cx, cy: p.cy, r: 5, class: "sc-dot" }, g);
    const showTip = () => {
      tip.textContent = "";
      tip.appendChild(el("strong", "", `${fmtPct(p.m.overall, total)}% · ${fmtCost(p.m.costs)}`));
      const name = el("span", "sc-tip-name");
      nameWithEffort(name, p.m);
      tip.appendChild(name);
      tip.appendChild(el("span", "sc-tip-meta",
        `${p.m.agent} · ${p.m.overall}/${total} resolved · ${fmtCost(p.m.costs / p.m.overall)} per resolved task`));
      tip.classList.add("visible");
      const left = p.cx + 14 + tip.offsetWidth > W ? p.cx - 14 - tip.offsetWidth : p.cx + 14;
      tip.style.left = `${Math.max(0, Math.min(W - tip.offsetWidth, left))}px`;
      tip.style.top = `${Math.max(0, p.cy - tip.offsetHeight / 2)}px`;
    };
    g.addEventListener("pointerenter", showTip);
    g.addEventListener("focus", showTip);
    g.addEventListener("pointerleave", hideTip);
    g.addEventListener("blur", hideTip);
  }

  // Name each point where a spot clear of other labels, dots and the plot edge exists; the tooltip and
  // the leaderboard table cover any point left unlabeled.
  const labels = svgEl("g", { "aria-hidden": "true" }, svg);
  for (const p of points) {
    const t = svgEl("text", { class: "sc-label" }, labels);
    t.textContent = p.m.name;
    const spot = LABEL_SPOTS.find(([dx, dy, anchor]) => {
      t.setAttribute("x", p.cx + dx);
      t.setAttribute("y", p.cy + dy);
      t.setAttribute("text-anchor", anchor);
      const b = t.getBBox();
      const inside = b.x >= 0 && b.x + b.width <= right && b.y >= pad.top && b.y + b.height <= bottom - 2;
      return inside && !obstacles.some((o) => overlaps(b, o));
    });
    if (spot) obstacles.push(t.getBBox());
    else t.remove();
  }
  box.appendChild(tip);
}

function fmtTokens(n) {
  return n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
}

// Model makers' colours as Artificial Analysis draws them.
const BRAND_COLORS = {
  anthropic: "#cc785c", openai: "#1f1f1f", moonshot: "#047afe", deepseek: "#2243e6", zhipu: "#1c7ff8",
};

function fmtTokenTick(n) {
  if (n === 0) return "0";
  return n >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : `${+(n / 1e6).toFixed(0)}M`;
}

function niceStep(max, ticks) {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
}

// Split a label into lines no wider than maxWidth, breaking only between words.
function wrapWords(text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.textContent.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    text.textContent = candidate;
    if (line && text.getComputedTextLength() > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  lines.push(line);
  return lines;
}

// A bar with rounded top corners.
function topRoundedBar(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Vertical bars in the style of Artificial Analysis: one bar per model in its maker's colour, sorted by
// value, with the value above and the maker's logo and model name below. segments(m) lists
// [tokens, opacity] from the bottom up; sub(m) is an optional second line under the value, and
// tipLines(m) gives the tooltip's headline and last line.
function renderTokenBars(box, models, segments, sub, tipLines) {
  box.textContent = "";
  const total = (m) => segments(m).reduce((s, [v]) => s + v, 0);
  const sorted = [...models].sort((a, b) => total(b) - total(a));
  const W = box.clientWidth;
  const H = W < 560 ? 270 : 300;
  // The second line under each value only fits on wide bars; the tooltip carries it otherwise.
  if ((W - 48) / sorted.length < 64) sub = null;
  const pad = { top: sub ? 36 : 22, right: 4, bottom: 70, left: 44 };
  const right = W - pad.right;
  const bottom = H - pad.bottom;
  const step = niceStep(total(sorted[0]), 5);
  const yMax = Math.ceil(total(sorted[0]) / step) * step;
  const y = (v) => bottom - (v / yMax) * (bottom - pad.top);

  const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "group" }, box);
  for (let t = 0; t <= yMax + step / 2; t += step) {
    svgEl("line", { x1: pad.left, x2: right, y1: y(t), y2: y(t), class: "sc-grid" }, svg);
    svgEl("text", { x: pad.left - 8, y: y(t) + 3.5, "text-anchor": "end", class: "sc-tick" }, svg).textContent =
      fmtTokenTick(t);
  }

  const tip = el("div", "sc-tip");
  const band = (right - pad.left) / sorted.length;
  const barW = Math.min(52, band * 0.62);
  sorted.forEach((m, i) => {
    const cx = pad.left + band * (i + 0.5);
    const color = BRAND_COLORS[m.vendor];
    const g = svgEl("g", { class: "tb-bar", tabindex: 0, "aria-label": `${m.name}: ${fmtTokens(total(m))}` }, svg);
    svgEl("rect", { x: cx - band / 2, y: pad.top, width: band, height: bottom - pad.top, class: "sc-hit" }, g);

    const segs = segments(m);
    let base = 0;
    segs.forEach(([v, opacity], k) => {
      // A 2px surface gap separates a segment from the one below it.
      const lower = y(base) - (k > 0 ? 2 : 0);
      const upper = y(base + v);
      base += v;
      if (lower - upper < 0.5) return;
      const d = k === segs.length - 1
        ? topRoundedBar(cx - barW / 2, upper, barW, lower - upper, 4)
        : `M${cx - barW / 2},${lower}V${upper}H${cx + barW / 2}V${lower}Z`;
      svgEl("path", { d, fill: color, "fill-opacity": opacity, class: "tb-seg" }, g);
    });

    const top = y(total(m));
    svgEl("text", { x: cx, y: top - (sub ? 19 : 7), "text-anchor": "middle", class: "tb-value" }, svg).textContent =
      fmtTokens(total(m));
    if (sub) {
      svgEl("text", { x: cx, y: top - 6, "text-anchor": "middle", class: "tb-sub" }, svg).textContent = sub(m);
    }

    const logo = svgEl("g", { transform: `translate(${cx - 8},${bottom + 9})`, fill: color, color }, svg);
    logo.innerHTML = VENDOR_ICONS[m.vendor].replace("<svg ", '<svg width="16" height="16" ');
    const name = svgEl("text", { x: cx, y: bottom + 40, "text-anchor": "middle", class: "tb-name" }, svg);
    name.textContent = m.name;
    const lines = wrapWords(name, band - 6);
    name.textContent = "";
    lines.forEach((line, j) => {
      svgEl("tspan", { x: cx, dy: j === 0 ? 0 : "1.2em" }, name).textContent = line;
    });

    const showTip = () => {
      const [headline, meta] = tipLines(m);
      tip.textContent = "";
      tip.appendChild(el("strong", "", headline));
      const label = el("span", "sc-tip-name");
      nameWithEffort(label, m);
      tip.appendChild(label);
      tip.appendChild(el("span", "sc-tip-meta", meta));
      tip.classList.add("visible");
      const left = cx - tip.offsetWidth / 2;
      tip.style.left = `${Math.max(0, Math.min(W - tip.offsetWidth, left))}px`;
      tip.style.top = `${Math.max(0, top - tip.offsetHeight - 10)}px`;
    };
    const hideTip = () => tip.classList.remove("visible");
    g.addEventListener("pointerenter", showTip);
    g.addEventListener("focus", showTip);
    g.addEventListener("pointerleave", hideTip);
    g.addEventListener("blur", hideTip);
  });
  box.appendChild(tip);
}

// Tokens of one run over all tasks: input not served from the prompt cache, cached input, and output.
function renderTokens(data) {
  const section = document.getElementById("tokens");
  section.hidden = !data.models.some((m) => m.tokens);
  if (section.hidden) return;
  const total = data.benchmark.total;
  document.getElementById("tokens-note").textContent = `${state.version} · Tokens used in one run over all ${total} tasks`;
  const models = data.models.filter((m) => state.agent === "All" || m.agent === state.agent);
  const cachedShare = (t) => (t.cached / (t.input + t.cached)) * 100;
  renderTokenBars(
    document.getElementById("tokens-input"), models,
    (m) => [[m.tokens.cached, 0.45], [m.tokens.input, 1]],
    (m) => `${Math.round(cachedShare(m.tokens))}% cached`,
    (m) => [
      `${fmtTokens(m.tokens.input + m.tokens.cached)} input tokens`,
      `${fmtTokens(m.tokens.cached)} cached (${cachedShare(m.tokens).toFixed(1)}%) · ${fmtTokens(m.tokens.input)} uncached`,
    ]
  );
  renderTokenBars(
    document.getElementById("tokens-output"), models,
    (m) => [[m.tokens.output, 1]],
    null,
    (m) => [`${fmtTokens(m.tokens.output)} output tokens`, `${Math.round(m.tokens.output / total / 1000)}K per task`]
  );
}

function renderVersion() {
  const wrap = document.getElementById("version-mode");
  wrap.textContent = "";
  for (const v of VERSIONS) {
    const btn = el("button", state.version === v.id ? "active" : "", v.id);
    btn.type = "button";
    btn.addEventListener("click", () => {
      if (state.version === v.id) return;
      state.version = v.id;
      state.agent = "All";
      state.sortKey = null;
      state.sortDir = -1;
      const url = new URL(location.href);
      if (v.id === VERSIONS[0].id) url.searchParams.delete("version");
      else url.searchParams.set("version", v.id);
      history.replaceState(null, "", url);
      render(scoresByVersion[v.id]);
    });
    wrap.appendChild(btn);
  }

  const v = VERSIONS.find((x) => x.id === state.version);
  const note = document.getElementById("version-note");
  note.textContent = `${v.id} · ${v.note}`;
  if (v.notes) {
    note.append(" · ");
    const link = el("a", "", "What changed →");
    link.href = v.notes;
    note.appendChild(link);
  }
}

function renderViewMode(data) {
  const wrap = document.getElementById("view-mode");
  wrap.textContent = "";
  for (const [key, label] of VIEW_MODES) {
    const btn = el("button", state.view === key ? "active" : "", label);
    btn.type = "button";
    btn.addEventListener("click", () => {
      state.view = key;
      state.sortKey = null;
      state.sortDir = -1;
      render(data);
    });
    wrap.appendChild(btn);
  }
}

function renderDisplayMode(data) {
  const wrap = document.getElementById("display-mode");
  wrap.textContent = "";
  for (const [key, label] of DISPLAY_MODES) {
    const btn = el("button", state.display === key ? "active" : "", label);
    btn.type = "button";
    btn.addEventListener("click", () => {
      state.display = key;
      render(data);
    });
    wrap.appendChild(btn);
  }
}

function renderFilters(data) {
  const wrap = document.getElementById("agent-filters");
  wrap.textContent = "";
  const agents = ["All", ...new Set(data.models.map((m) => m.agent))];
  for (const agent of agents) {
    const btn = el("button", state.agent === agent ? "active" : "", agent);
    btn.type = "button";
    btn.addEventListener("click", () => {
      state.agent = agent;
      render(data);
    });
    wrap.appendChild(btn);
  }
  if (state.sortKey !== null) {
    const reset = el("button", "", "Reset order");
    reset.type = "button";
    reset.addEventListener("click", () => {
      state.sortKey = null;
      state.sortDir = -1;
      render(data);
    });
    wrap.appendChild(reset);
  }
}

function bestPerColumn(data) {
  const best = { overall: 0, precision: 0 };
  for (const repo of data.benchmark.repos) best[repo.id] = 0;
  for (const m of data.models) {
    best.overall = Math.max(best.overall, pct(m.overall, data.benchmark.total));
    best.precision = Math.max(best.precision, m.precision);
    for (const repo of data.benchmark.repos) {
      best[repo.id] = Math.max(best[repo.id], pct(m.resolved[repo.id], repo.cases));
    }
  }
  return best;
}

function scoreCell(resolved, total, isBest) {
  const classes = [state.display === "pct" ? "score-pct" : "score-count"];
  if (isBest) classes.push("best");
  const td = el("td", classes.join(" "));
  const val = el("span", "val");
  val.textContent =
    state.display === "pct" ? `${fmtPct(resolved, total)}%` : `${resolved}/${total}`;
  td.appendChild(val);
  return td;
}

function appendRow(tbody, m, rank, data, best) {
  const tr = el("tr", "data-row");
  const rankTd = el("td", "rank");
  rankTd.appendChild(el("span", rank <= 3 ? "medal" : "rank-num", String(rank)));
  tr.appendChild(rankTd);
  const nameTd = el("td", "model-name");
  nameWithEffort(nameTd, m);
  tr.appendChild(nameTd);
  tr.appendChild(el("td", "agent-name", m.agent));
  const total = data.benchmark.total;
  tr.appendChild(scoreCell(m.overall, total, false));
  for (const repo of data.benchmark.repos) {
    tr.appendChild(
      scoreCell(m.resolved[repo.id], repo.cases, pct(m.resolved[repo.id], repo.cases) === best[repo.id])
    );
  }
  const prec = el("td", m.precision === best.precision ? "precision-cell best" : "precision-cell");
  const precVal = el("span", "val", m.precision.toFixed(3));
  prec.appendChild(precVal);
  tr.appendChild(prec);
  tr.appendChild(el("td", "cost-cell", fmtCost(m.costs)));
  tbody.appendChild(tr);
}

function sortValue(m, key, data) {
  if (key === "model") return m.name.toLowerCase();
  if (key === "agent") return m.agent.toLowerCase();
  if (key === "overall") return pct(m.overall, data.benchmark.total);
  if (key === "precision") return m.precision;
  if (key === "cost") return m.costs ?? -1;
  return pct(m.resolved[key], data.benchmark.repos.find((r) => r.id === key).cases);
}

function renderTable(data) {
  const thead = document.querySelector("#scores thead");
  const tbody = document.querySelector("#scores tbody");
  thead.textContent = "";
  tbody.textContent = "";

  const headRow = el("tr");
  const rankTh = el("th", "", "Rank");
  rankTh.classList.add("has-tip");
  rankTh.title = "Global rank by overall resolved rate; rows are grouped by model type.";
  headRow.appendChild(rankTh);
  const columns = [
    ["model", "Model", null],
    ["agent", "Scaffold", null],
    ["overall", "Overall", `${data.benchmark.total} cases`],
    ...data.benchmark.repos.map((r) => [r.id, r.name, `${r.cases} cases`]),
    ["precision", "Precision*", null],
    ["cost", "Cost", "USD"],
  ];
  for (const [key, label, sub] of columns) {
    const th = el("th", "", label);
    if (sub) th.appendChild(el("span", "th-sub", sub));
    if (state.sortKey === key) th.className = (th.className ? th.className + " " : "") + (state.sortDir === 1 ? "sorted-asc" : "sorted-desc");
    th.addEventListener("click", () => {
      if (state.sortKey === key) {
        state.sortDir = -state.sortDir;
      } else {
        state.sortKey = key;
        state.sortDir = key === "model" || key === "agent" || key === "cost" ? 1 : -1;
      }
      render(data);
    });
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  const best = bestPerColumn(data);
  const visible = data.models.filter((m) => state.agent === "All" || m.agent === state.agent);
  const ranks = new Map(sortedByOverall(data.models).map((m, i) => [m, i + 1]));

  if (state.sortKey === null && state.view === "type") {
    for (const group of ["proprietary", "open-source"]) {
      const members = sortedByOverall(visible.filter((m) => m.group === group));
      if (members.length === 0) continue;
      const grow = el("tr", "group-row");
      const td = el("td", "", GROUP_LABELS[group]);
      td.colSpan = columns.length + 1;
      grow.appendChild(td);
      tbody.appendChild(grow);
      for (const m of members) appendRow(tbody, m, ranks.get(m), data, best);
    }
  } else {
    const sorted =
      state.sortKey === null
        ? sortedByOverall(visible)
        : [...visible].sort((a, b) => {
            const va = sortValue(a, state.sortKey, data);
            const vb = sortValue(b, state.sortKey, data);
            const cmp = va < vb ? -1 : va > vb ? 1 : 0;
            return cmp * state.sortDir;
          });
    for (const m of sorted) appendRow(tbody, m, ranks.get(m), data, best);
  }
}

function render(data) {
  renderStats(data);
  renderChart(data);
  renderScatter(data);
  renderTokens(data);
  renderVersion();
  renderViewMode(data);
  renderDisplayMode(data);
  renderFilters(data);
  renderTable(data);
}

async function main() {
  await Promise.all(
    VERSIONS.map(async (v) => {
      const resp = await fetch(v.file);
      scoresByVersion[v.id] = await resp.json();
    })
  );
  const requested = new URLSearchParams(location.search).get("version");
  if (VERSIONS.some((v) => v.id === requested)) state.version = requested;
  render(scoresByVersion[state.version]);

  // The SVG charts are drawn at the container's width: redraw them whenever it changes, including when a
  // page loaded in a hidden or collapsed view becomes visible.
  let chartWidth = document.getElementById("scatter").clientWidth;
  new ResizeObserver(() => {
    const width = document.getElementById("scatter").clientWidth;
    if (width === chartWidth) return;
    chartWidth = width;
    renderScatter(scoresByVersion[state.version]);
    renderTokens(scoresByVersion[state.version]);
  }).observe(document.getElementById("scatter"));

  if (location.hash) {
    const target = document.querySelector(location.hash);
    if (target) target.scrollIntoView();
  }

  document.getElementById("copy-bibtex").addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    await navigator.clipboard.writeText(document.getElementById("bibtex").textContent);
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = "Copy"), 1500);
  });
}

main();
