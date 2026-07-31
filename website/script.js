const state = { agent: "All", sortKey: null, sortDir: -1, display: "pct", view: "rank" };

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
    row.appendChild(el("div", "chart-label", m.name));
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
  tr.appendChild(el("td", "model-name", m.name));
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
  if (key === "costs") return m.costs;
  if (key === "precision") return m.precision;
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
    ["costs", "Costs", null],
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
        state.sortDir = key === "model" || key === "agent" || key === "costs" ? 1 : -1;
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
  renderViewMode(data);
  renderDisplayMode(data);
  renderFilters(data);
  renderTable(data);
}

async function main() {
  const resp = await fetch("scores.json");
  const data = await resp.json();
  render(data);

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
