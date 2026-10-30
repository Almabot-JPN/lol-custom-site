// 月別（#/months?m=YYYY-MM&sort=..&order=..）。app.js の SITE・esc・link・pct・wrText・avgBadge・withAvatar・champImg・num を使う
const MONTH_COLS = [   // [キー, 見出し, 値の取り出し, 表示]
  ["games", "試合", (p) => p.games, (p) => p.games],
  ["wins", "勝敗", (p) => p.wins, (p) => `${p.wins}勝${p.games - p.wins}敗`],
  ["win_rate", "勝率", (p) => p.wins / p.games, (p) => wrText(p.wins / p.games)],
  ["ai_avg", "AIスコア", (p) => p.ai_avg, (p) => avgBadge(p.ai_avg)],
  ["k", "K/D/A", (p) => p.kda[0], (p) => p.kda.join(" / ")],
  ["kda_ratio", "KDA", (p) => p.kda_ratio, (p) => p.kda_ratio],
  ["points_delta", "ポイント", (p) => p.points_delta, (p) => `<span class="delta ${p.points_delta >= 0 ? "up" : "down"}">${p.points_delta >= 0 ? "+" : ""}${p.points_delta}</span>`],
];

const monthLabel = (m) => { const [y, mo] = m.split("-"); return `${Number(y)}年${Number(mo)}月`; };

function renderMonths(month, sortKey, order) {
  const months = SITE.monthly || [];
  if (!months.length) return `<h2>月別</h2><p class="muted">まだ試合がありません</p>`;
  const cur = months.find((x) => x.month === month) || months[0];
  const col = MONTH_COLS.find((c) => c[0] === sortKey) || MONTH_COLS.find((c) => c[0] === "ai_avg");
  const asc = order === "asc";
  const base = `#/months?m=${cur.month}`;
  const list = [...cur.players].sort((x, y) => {
    const a = col[2](x), b = col[2](y);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return asc ? a - b : b - a;
  });
  const chips = months.map((x) => `<a href="#/months?m=${x.month}" class="${x.month === cur.month ? "active" : ""}">${monthLabel(x.month)}</a>`).join("");
  const head = MONTH_COLS.map(([key, label]) => {
    const next = key === col[0] && !asc ? "asc" : "desc";
    return `<th class="num${key === col[0] ? " active" : ""}"><a href="${base}&sort=${key}&order=${next}">${label}${key === col[0] ? (asc ? " ▲" : " ▼") : ""}</a></th>`;
  }).join("");
  const rows = list.map((p) => `<tr><td><a href="${link("players", p.name)}">${withAvatar(p.name, 24)}</a></td>
    ${MONTH_COLS.map(([, , , show]) => `<td class="num">${show(p)}</td>`).join("")}
    <td class="champs">${p.champions.map((c) => champImg(c, 22)).join("")}</td></tr>`).join("");
  const note = (SITE.monthly_notes || {})[cur.month];
  const noteHtml = note
    ? note.split(/\n\s*\n/).map((t) => `<p class="month-note">${esc(t.trim())}</p>`).join("")
    : `<p class="muted">この月の総評はまだありません</p>`;
  const days = cur.days.map((d) => d.slice(5).replace("-", "/")).join("・");
  return `<section class="months-page">
    <p class="sort month-chips">${chips}</p>
    <h2>${monthLabel(cur.month)}</h2>
    <p class="muted month-summary">${cur.days.length}日・${cur.games}試合（Blue ${cur.blue_wins}勝・Red ${cur.red_wins}勝）／ 開催日 ${days}</p>
    <div class="month-review"><h3>AIの総評</h3>${noteHtml}</div>
    <h3>プレイヤーの戦績</h3>
    <div class="table-wrap"><table class="months"><thead><tr><th>参加者</th>${head}<th>よく使ったチャンピオン</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
  </section>`;
}
