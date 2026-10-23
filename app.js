"use strict";
// 身内向け戦績サイト。data.enc.json をパスワードで復号し（PBKDF2-SHA256 + AES-GCM）、ハッシュルーティングで描画する。

const KEY_STORE = "lolrec.key";
const $ = (sel) => document.querySelector(sel);
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function deriveKey(password, blob) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64(blob.salt), iterations: blob.iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
}

async function decryptWith(key, blob) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(blob.iv) }, key, b64(blob.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

function loadStoredKey() {
  try { return localStorage.getItem(KEY_STORE); } catch (e) { return null; }
}
function storeKey(value) {
  try { value === null ? localStorage.removeItem(KEY_STORE) : localStorage.setItem(KEY_STORE, value); } catch (e) { /* 保存できなくても動く */ }
}

async function start() {
  const blob = await (await fetch("data.enc.json", { cache: "no-store" })).json();
  const stored = loadStoredKey();
  if (stored) {
    try {
      const key = await crypto.subtle.importKey("raw", b64(stored), "AES-GCM", true, ["decrypt"]);
      return open(await decryptWith(key, blob));
    } catch (e) {
      storeKey(null);                             // パスワードが変わった・壊れた鍵
    }
  }
  $("#gate").hidden = false;
  $("#gate-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("#error").textContent = "";
    try {
      const key = await deriveKey($("#password").value, blob);
      const data = await decryptWith(key, blob);
      if ($("#remember").checked) storeKey(toB64(await crypto.subtle.exportKey("raw", key)));
      open(data);
    } catch (e) {
      $("#error").textContent = "パスワードが違います";
    }
  });
}

function open(data) {
  window.SITE = data;
  $("#gate").hidden = true;
  $("#app").hidden = false;
  $("#footer").textContent = `更新: ${data.generated_at.slice(0, 16).replace("T", " ")} ／ ${data.summary.games}試合`;
  window.addEventListener("hashchange", route);
  if (!location.hash) location.hash = "#/";
  route();
}

// ---- ルーティング ----
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const link = (kind, name) => `#/${kind}/${encodeURIComponent(name)}`;

function route() {
  const [path, query] = location.hash.slice(2).split("?");
  const [tab, param] = path.split("/");
  const params = new URLSearchParams(query || "");
  document.querySelectorAll("nav a[data-tab]").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  const view = $("#view");
  const name = param !== undefined ? decodeURIComponent(param) : undefined;
  const pages = {
    players: () => (name === undefined ? renderPlayers(params.get("sort"), params.get("order")) : renderPlayer(name)),
    matches: () => (name === undefined ? renderMatches() : renderMatch(Number(name))),
    champions: () => (name === undefined ? renderChampions(params.get("sort") || "picks") : renderChampion(name)),
    records: () => renderRecords(),
    tier: () => renderTier(params.get("role") || "TOP"),
    teams: () => renderTeams(),
  };
  const isCover = !pages[tab];                    // #/ や不明なページは表紙（cover.js）
  document.body.classList.toggle("on-cover", isCover);
  view.innerHTML = isCover ? renderCover() : pages[tab]();
  if (isCover) startCover(view);
  window.scrollTo(0, 0);
}

// ---- 表示の部品 ----
const SCORE_COLORS = [[100, "#F5A623"], [75, "#F0883E"], [50, "#4CAF8C"], [25, "#E5686A"], [-Infinity, "#8A93A6"]];
function scoreBadge(score, digits = null) {   // digits: 平均は 1（59 → 59.0）、1試合のスコアは整数のまま
  if (score === null || score === undefined) return `<span class="score none">-</span>`;
  const color = SCORE_COLORS.find(([min]) => score >= min)[1];
  const text = digits !== null ? score.toFixed(digits) : Number.isInteger(score) ? score : score.toFixed(1);
  return `<span class="score" style="background:${color};color:#fff">${text}</span>`;
}
const avgBadge = (score) => scoreBadge(score, 1);
const pct = (r) => `${Math.round(r * 100)}%`;
// 勝率の色: 60%以上 / 50〜59% / 40〜49% / 40%未満
const wrClass = (r) => {                        // 表示している % と色がずれないよう、丸めた値で判定
  const v = Math.round(r * 100);
  return v >= 60 ? "wr-best" : v >= 50 ? "wr-good" : v >= 40 ? "wr-warn" : "wr-bad";
};
const wrText = (r) => `<span class="wr ${wrClass(r)}">${pct(r)}</span>`;
const num = (v) => (v === null || v === undefined ? "-" : Number(v).toLocaleString("ja-JP"));
const player = (name) => SITE.players.find((p) => p.name === name);
const match = (id) => SITE.matches.find((m) => m.id === id);
const champion = (name) => SITE.champions.find((c) => c.name === name);
const notFound = (what) => `<h2>${esc(what)}</h2><p class="muted">見つかりませんでした。</p>`;

function trendSvg(points) {
  const pts = points.filter((p) => p.avg !== null);
  if (pts.length === 0) return `<p class="muted">AIスコアのデータがありません</p>`;
  const w = 600, h = 140, pad = 24;
  const x = (i) => (pts.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (pts.length - 1));
  const y = (v) => h - pad - ((Math.min(Math.max(v, 20), 80) - 20) / 60) * (h - pad * 2);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`).join(" ");
  const dots = pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.avg)}" r="3" fill="#F0883E"><title>${esc(p.month)}: ${p.avg}（${p.games}試合）</title></circle>`).join("");
  const labels = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? `<text x="${x(i)}" y="${h - 6}" fill="#8a93a6" font-size="11" text-anchor="middle">${esc(p.month)}</text>` : "")).join("");
  return `<svg class="trend" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <line x1="${pad}" x2="${w - pad}" y1="${y(50)}" y2="${y(50)}" stroke="#2a3240" stroke-dasharray="4"/>
    <path d="${path}" fill="none" stroke="#F0883E" stroke-width="2"/>${dots}${labels}</svg>`;
}

// ---- ポイント（100pt = 1ディビジョン。2800 = マスター0LP） ----
const RANK_TIERS_SHORT = "IBSGPED";
function pointsLabel(points) {
  const v = points / 100;
  if (v >= 27.5) {
    const lp = Math.round((v - 28) * 2) * 50;
    return lp >= 1000 ? "GM" : `マスター${Math.max(lp, 0)}LP`;
  }
  const r = Math.max(0, Math.round(v));
  return `${RANK_TIERS_SHORT[Math.floor(r / 4)]}${4 - (r % 4)}`;
}
const deltaText = (d) => (d === undefined || d === null ? "" : `<span class="delta ${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : ""}${d}</span>`);
function pointsTrendSvg(start, history) {
  if (!history || history.length === 0) return `<p class="muted">ポイントのデータがありません</p>`;
  const vals = [start, ...history.map((h) => h.points)];
  const w = 600, h = 140, pad = 24;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(hi - lo, 40);
  const x = (i) => pad + (i * (w - pad * 2)) / (vals.length - 1);
  const y = (v) => h - pad - ((v - lo) / span) * (h - pad * 2);
  const path = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const label = (i, anchor) => `<text x="${x(i)}" y="${y(vals[i]) - 8}" fill="#8a93a6" font-size="11" text-anchor="${anchor}">${num(vals[i])}</text>`;
  return `<svg class="points-trend" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <line x1="${pad}" x2="${w - pad}" y1="${y(start)}" y2="${y(start)}" stroke="#2a3240" stroke-dasharray="4"/>
    <path d="${path}" fill="none" stroke="#4CAF8C" stroke-width="2"/>${label(0, "start")}${label(vals.length - 1, "end")}</svg>`;
}

// ---- 画像（チャンピオン・参加者アイコン） ----
const initial = (name) => esc(String(name || "?").slice(0, 1));
// 画像が読めないときは頭文字の四角／丸に差し替える（文字は textContent で入れる）
function imgFallback(img) {
  const span = document.createElement("span");
  span.className = img.dataset.fallback;
  span.style.width = span.style.height = `${img.width}px`;
  span.textContent = img.dataset.initial;
  img.replaceWith(span);
}
function champUrl(name) {
  const id = SITE.champion_ids && SITE.champion_ids[name];
  return id && SITE.ddragon_version ? `https://ddragon.leagueoflegends.com/cdn/${SITE.ddragon_version}/img/champion/${id}.png` : null;
}
function champImg(name, size = 28) {
  const url = champUrl(name);
  const fallback = `<span class="champ-fallback" style="width:${size}px;height:${size}px">${initial(name)}</span>`;
  if (!url) return fallback;
  return `<img class="champ" src="${url}" alt="${esc(name)}" width="${size}" height="${size}" loading="lazy" data-fallback="champ-fallback" data-initial="${initial(name)}" onerror="imgFallback(this)">`;
}
function avatar(name, size = 28) {
  const p = player(name);
  const own = SITE.icons && SITE.icons[name];
  const champ = p && p.champions.length ? champUrl(p.champions[0].champion) : null;
  const src = own || champ;
  const fallback = `<span class="avatar-fallback" style="width:${size}px;height:${size}px">${initial(name)}</span>`;
  if (!src) return fallback;
  return `<img class="avatar" src="${src}" alt="" width="${size}" height="${size}" loading="lazy" data-fallback="avatar-fallback" data-initial="${initial(name)}" onerror="imgFallback(this)">`;
}
const withAvatar = (name, size) => `<span class="who">${avatar(name, size)}<span class="nm">${esc(name)}</span></span>`;
const withChamp = (name, size) => `<span class="who">${champImg(name, size)}<span class="nm">${esc(name)}</span></span>`;

// ---- ランクのマーク（Riot 公式素材を Community Dragon から） ----
const CREST_URL = "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/";
const RANK_TIERS = [   // 前から順に一致を見る（GM・HM を G・M より先に）
  [/^(GM|グランドマスター)/, "grandmaster"], [/^(HM|M|マスター)/, "master"], [/^C/, "challenger"],
  [/^I/, "iron"], [/^B/, "bronze"], [/^S/, "silver"], [/^G/, "gold"], [/^P/, "platinum"], [/^E/, "emerald"], [/^D/, "diamond"],
];
function rankImg(rank, size = 20) {
  const hit = rank && RANK_TIERS.find(([re]) => re.test(String(rank)));
  if (!hit) return "";
  return `<img class="rank" src="${CREST_URL}${hit[1]}.svg" alt="" width="${size}" height="${size}" loading="lazy" onerror="this.remove()">`;
}

// ---- tier ----
const TIER_ROLES = ["TOP", "JG", "MID", "BOT", "SUP"];
function renderTier(role) {
  const r = TIER_ROLES.includes(role) ? role : "TOP";
  const roles = TIER_ROLES.map((x) => `<a href="#/tier?role=${x}" class="${x === r ? "active" : ""}">${x}</a>`).join("");
  const rows = (SITE.tiers && SITE.tiers[r]) || [];
  const body = rows.length
    ? rows.map((x) => `<a class="row tier-row" href="${link("champions", x.champion)}">
        <span class="tier tier-${x.tier}">${x.tier}</span>${withChamp(x.champion, 32)}
        <span class="muted">${x.picks}戦 ${pct(x.win_rate)} ／ Ban ${x.bans}</span>${avgBadge(x.ai_avg)}</a>`).join("")
    : `<p class="muted">このロールで3回以上ピックされたチャンピオンがまだいないため、データがありません。</p>`;
  return `<h2>チャンピオン tier</h2>
    <p class="muted">このカスタム内の成績から。補正勝率50%・平均AIスコア30%・人気（ピック＋Ban）20%で点数をつけ、S〜Dに分けています。</p>
    <p class="sort roles">ロール：${roles}</p><div class="list">${body}</div>`;
}

// ---- プレイヤー ----
const FEW_STORE = "lolrec.showFew";
const PLAYER_COLS = [   // [キー, 見出し, 値の取り出し, 表示]
  ["rank", "ランク", null, (p) => `<span class="who">${esc(p.rank || "-")}${rankImg(p.rank)}</span>`],
  ["games", "ゲーム数", (p) => p.games, (p) => p.games],
  ["participation", "参加率", (p) => p.participation, (p) => pct(p.participation)],
  ["wins", "勝利数", (p) => p.wins, (p) => p.wins],
  ["losses", "敗北数", (p) => p.losses, (p) => p.losses],
  ["ai_avg", "AIスコア", (p) => p.ai_avg, (p) => avgBadge(p.ai_avg)],
  ["points", "ポイント", (p) => p.points, (p) => num(p.points)],
  ["win_rate", "勝率", (p) => p.win_rate, (p) => pct(p.win_rate)],
  ["k", "キル平均", (p) => p.kda[0], (p) => p.kda[0]],
  ["d", "デス平均", (p) => p.kda[1], (p) => p.kda[1]],
  ["a", "アシスト平均", (p) => p.kda[2], (p) => p.kda[2]],
  ["kda_ratio", "KDA", (p) => p.kda_ratio, (p) => p.kda_ratio],
  ["damage_avg", "Damage平均", (p) => p.damage_avg, (p) => num(p.damage_avg)],
  ["dpm", "Damage/min", (p) => p.dpm, (p) => num(p.dpm)],
  ["kp", "KP", (p) => p.kp, (p) => pct(p.kp)],
];
let fewOn = (() => { try { return localStorage.getItem(FEW_STORE) === "1"; } catch (e) { return false; } })();
const showFew = () => fewOn;
function setShowFew(on) {
  fewOn = on;                                              // 画面の状態はこの変数が正。保存は覚えられたら
  try { on ? localStorage.setItem(FEW_STORE, "1") : localStorage.removeItem(FEW_STORE); } catch (e) { /* 覚えられなくても動く */ }
  route();
}
function renderPlayers(sortKey, order) {
  const col = PLAYER_COLS.find((c) => c[0] === sortKey && c[2]) || PLAYER_COLS.find((c) => c[0] === "ai_avg");
  const asc = order === "asc";
  const few = showFew();
  const list = SITE.players.filter((p) => few || p.games >= 10).sort((x, y) => {
    const a = col[2](x), b = col[2](y);
    if (a === null || a === undefined) return 1;           // 値のない人はいつも最後
    if (b === null || b === undefined) return -1;
    return asc ? a - b : b - a;
  });
  const head = PLAYER_COLS.map(([key, label, get]) => {
    if (!get) return `<th>${label}</th>`;
    const next = key === col[0] && !asc ? "asc" : "desc";
    return `<th class="num${key === col[0] ? " active" : ""}"><a href="#/players?sort=${key}&order=${next}">${label}${key === col[0] ? (asc ? " ▲" : " ▼") : ""}</a></th>`;
  }).join("");
  const rows = list.map((p) => `<tr><td><a href="${link("players", p.name)}">${withAvatar(p.name, 24)}</a>${p.games < 10 ? ' <span class="muted">（参考）</span>' : ""}</td>
    ${PLAYER_COLS.map(([key, , get, show]) => `<td class="${get ? "num" : ""}">${show(p)}</td>`).join("")}</tr>`).join("");
  return `<h2>プレイヤー</h2>
    <p class="muted">見出しを押すと並べ替えます（もう一度押すと逆順）。Damage は SUP の試合を除いた値です。</p>
    <label class="toggle"><input type="checkbox" id="show-few" ${few ? "checked" : ""} onchange="setShowFew(this.checked)"> 10試合未満も表示</label>
    <div class="table-wrap"><table class="players"><thead><tr><th>参加者</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Claude が書いた分析文。空行で段落を分け、文字はそのまま（HTML として解釈しない）表示する
function analysisBox(name) {
  const a = SITE.analysis && SITE.analysis.players && SITE.analysis.players[name];
  if (!a || !a.text) return "";
  const when = `${esc(String(SITE.analysis.written || "").replaceAll("-", "/"))}・${a.games}試合時点`;
  const body = a.text.split(/\n\s*\n/).map((t) => `<p class="body">${esc(t.trim())}</p>`).join("");
  return `<section class="analysis"><h3>AI分析 <span class="muted">${when}</span></h3>${body}</section>`;
}

// 同じロールで3回以上向かい合った相手（多い順に8人）。勝敗はその試合のチームの勝敗、AI差は自分 − 相手
function laneOpponents(list, me) {
  const rows = (list || []).filter((o) => o.games >= 3).slice(0, 8);
  const body = rows.length
    ? rows.map((o) => {
        const diff = o.ai_diff === null ? "-" : `${o.ai_diff >= 0 ? "+" : ""}${o.ai_diff.toFixed(1)}`;
        return `<details class="lane-opp"><summary class="row">${withAvatar(o.name, 24)}
          <span class="lane-rec"><span class="muted">${o.games}回 ${esc(o.roles.join("・"))}</span><span>${o.wins}勝${o.games - o.wins}敗 ${wrText(o.wins / o.games)}</span></span>
          <span class="ai-diff ${o.ai_diff === null ? "" : o.ai_diff >= 0 ? "up" : "down"}">AI差 ${diff}</span></summary>
          ${laneGames(me, o.name)}</details>`;
      }).join("")
    : '<p class="muted">3回以上向かい合った相手はまだいません</p>';
  return `<h3>よく当たる対面 <span class="muted">（押すと試合の一覧）</span></h3><div class="list lane-opponents">${body}</div>`;
}

// me と opp が同じロールで向かい合った試合（新しい順）。自分と相手のチャンピオン・K/D/A・勝敗・自分の AIスコア
function laneGames(me, opp) {
  const rows = SITE.matches.flatMap((m) => {
    const a = m.players.find((x) => x.name === me);
    const b = a && m.players.find((x) => x.name === opp && x.side !== a.side && x.role === a.role);
    if (!b) return [];
    const win = (a.side === "Blue") === m.blue_win;
    return [`<a class="row lane-game" href="${link("matches", m.id)}">
      <span class="muted">${m.date.slice(5).replace("-", "/")} 第${m.id}試合</span>
      <span class="${win ? "win" : "loss"}">${win ? "勝ち" : "負け"}</span>
      <span class="vs">${champImg(a.champion, 24)}<small>vs</small>${champImg(b.champion, 24)}<span class="kda">${a.k}/${a.d}/${a.a} <small class="muted">vs ${b.k}/${b.d}/${b.a}</small></span></span>
      ${scoreBadge(a.score)}</a>`];
  });
  return `<div class="list lane-games">${rows.join("")}</div>
    <a class="to-player" href="${link("players", opp)}">${esc(opp)} のページへ</a>`;
}

function renderPlayer(name) {
  const p = player(name);
  if (!p) return notFound(name);
  const mates = (list) => (list.length ? list.map((m) => `<span class="chip">${avatar(m.name, 20)} ${esc(m.name)} ${pct(m.win_rate)}（${m.games}）</span>`).join("") : '<span class="muted">10試合以上一緒の人がいません</span>');
  const recent = p.recent.map((id) => {
    const m = match(id), me = m.players.find((x) => x.name === p.name);
    const win = (me.side === "Blue") === m.blue_win;
    return `<a class="row match" href="${link("matches", id)}"><span>${m.date.slice(5).replace("-", "/")} 第${id}試合</span>
      <span class="${win ? "win" : "loss"}">${win ? "勝ち" : "負け"}</span><span>${withChamp(me.champion, 24)} ${me.k}/${me.d}/${me.a}</span>${scoreBadge(me.score)}</a>`;
  }).join("");
  return `<div class="head">${avatar(p.name, 56)}<h2>${esc(p.name)}</h2></div>
    <p class="muted rank-line">登録ランク ${esc(p.rank || "-")}${rankImg(p.rank)} ／ 推定 ${esc(p.est_rank || "-（10試合以上で表示）")}${rankImg(p.est_rank)}</p>
    <div class="stats">
      <div class="stat"><b>${avgBadge(p.ai_avg)}</b>AIスコア</div>
      <div class="stat points"><b>${num(p.points)}pt</b>ポイント ${deltaText(p.points_last)}<small>${esc(pointsLabel(p.points))}相当</small></div>
      <div class="stat"><b>${p.games}</b>試合</div>
      <div class="stat"><b>${pct(p.win_rate)}</b>勝率</div>
      <div class="stat"><b>${p.mvp}</b>MVP</div>
      <div class="stat"><b>${p.kda.join("/")}</b>平均K/D/A</div>
      <div class="stat"><b>${p.kda_ratio}</b>KDA</div>
      <div class="stat"><b>${pct(p.kp)}</b>KP</div>
      <div class="stat"><b>${num(p.dpm)}</b>Damage/min</div>
      <div class="stat"><b>${pct(p.participation)}</b>参加率</div>
    </div>
    ${analysisBox(p.name)}
    <h3>AIスコアの推移（月ごと）</h3>${trendSvg(p.monthly_ai)}
    <h3>ポイントの推移（試合ごと）</h3>${pointsTrendSvg(p.points_start, p.points_history)}
    <h3>ロール別</h3><div class="list">${p.roles.map((r) => `<div class="row"><span>${r.role}</span><span><span class="muted">${r.games}試合</span> ${wrText(r.win_rate)}</span>${avgBadge(r.ai_avg)}</div>`).join("")}</div>
    <h3>チャンピオン</h3><div class="list">${p.champions.slice(0, 8).map((c) => `<a class="row" href="${link("champions", c.champion)}">${withChamp(c.champion, 28)}<span class="muted">${c.wins}勝${c.games - c.wins}敗</span>${avgBadge(c.ai_avg)}</a>`).join("")}</div>
    <h3>相性の良い味方</h3><div class="chips">${mates(p.best_mates)}</div>
    <h3>相性の悪い味方</h3><div class="chips">${mates(p.worst_mates)}</div>
    ${laneOpponents(p.lane_opponents, p.name)}
    <h3>最近の試合</h3><div class="list">${recent}</div>`;
}

// ---- 試合 ----
function renderMatches() {
  const byDate = new Map();
  SITE.matches.forEach((m) => byDate.set(m.date, [...(byDate.get(m.date) || []), m]));
  const days = [...byDate].map(([day, ms]) => `<h3>${day.replaceAll("-", "/")}（${ms.length}試合）</h3><div class="list">${ms.map((m) => {
    const mvp = m.players.find((x) => x.name === m.mvp);
    return `<a class="row match" href="${link("matches", m.id)}"><span>第${m.id}試合</span>
      <span class="${m.blue_win ? "win" : "loss"}">${m.blue_win ? "Blue" : "Red"}勝ち</span><span class="muted">${esc(m.duration)}</span>
      <span>MVP ${esc(m.mvp || "-")} ${mvp ? scoreBadge(mvp.score) : ""}</span></a>`;
  }).join("")}</div>`).join("");
  return `<h2>試合</h2>${days}`;
}

function renderMatch(id) {
  const m = match(id);
  if (!m) return notFound(`第${id}試合`);
  const rows = m.players.map((x) => `<tr class="${x.side.toLowerCase()}">
      <td>${x.role}</td><td><a href="${link("players", x.name)}">${withAvatar(x.name, 24)}</a></td>
      <td><a href="${link("champions", x.champion)}">${withChamp(x.champion, 24)}</a></td>
      <td class="mid">${scoreBadge(x.score)}</td><td class="num">${x.k}/${x.d}/${x.a}</td><td class="num">${num(x.cs)}</td>
      <td class="num">${num(x.damage)}</td><td class="num taken">${num(x.taken)}</td><td class="num vision">${num(x.vision)}</td>
      <td class="mid">${x.ban ? champImg(x.ban, 24) : "-"}</td></tr>`).join("");
  return `<h2>第${m.id}試合</h2>
    <p class="muted">${m.date.replaceAll("-", "/")} ／ ${esc(m.duration)} ／ <span class="${m.blue_win ? "win" : "loss"}">${m.blue_win ? "Blue" : "Red"}の勝ち</span> ／ MVP ${esc(m.mvp || "-")}</p>
    <div class="table-wrap"><table class="scoreboard">
      <tr><th>ロール</th><th>参加者</th><th>チャンピオン</th><th class="mid">AI</th><th class="num">K/D/A</th><th class="num">CS</th><th class="num">ダメージ</th><th class="num">被ダメ</th><th class="num">視界</th><th class="mid">Ban</th></tr>
      ${rows}</table></div>`;
}

// ---- チャンピオン ----
const CHAMP_SORTS = [["picks", "ピック"], ["bans", "Ban"], ["win_rate", "勝率"], ["presence", "登場率"]];
function renderChampions(sortKey) {
  const key = CHAMP_SORTS.some(([k]) => k === sortKey) ? sortKey : "picks";
  const list = [...SITE.champions].sort((a, b) => b[key] - a[key] || b.picks - a.picks);
  const sorts = CHAMP_SORTS.map(([k, label]) => `<a href="#/champions?sort=${k}" class="${k === key ? "active" : ""}">${label}</a>`).join("");
  const rows = list.map((c) => `<a class="row" href="${link("champions", c.name)}">${withChamp(c.name, 32)}
      <span class="muted">${c.picks}ピック ／ Ban ${c.bans}</span><span>${c.picks ? pct(c.win_rate) : "-"}</span></a>`).join("");
  return `<h2>チャンピオン</h2><p class="sort">並べ替え：${sorts}</p><div class="list">${rows}</div>`;
}

function renderChampion(name) {
  const c = champion(name);
  if (!c) return notFound(name);
  return `<div class="head">${champImg(c.name, 56)}<h2>${esc(c.name)}</h2></div>
    <div class="stats">
      <div class="stat"><b>${c.picks}</b>ピック</div><div class="stat"><b>${c.picks ? pct(c.win_rate) : "-"}</b>勝率</div>
      <div class="stat"><b>${c.bans}</b>Ban</div><div class="stat"><b>${pct(c.presence)}</b>登場率</div>
      <div class="stat"><b>${avgBadge(c.ai_avg)}</b>平均AI</div>
    </div>
    <p class="muted">ロール：${esc(c.roles.join(" ／ ") || "-")}</p>
    <h3>使い手</h3><div class="list">${c.users.map((u) => `<a class="row" href="${link("players", u.name)}">${withAvatar(u.name, 28)}<span class="muted">${u.games}試合</span><span>${u.wins}勝${u.games - u.wins}敗</span></a>`).join("") || '<p class="muted">ピックなし</p>'}</div>
    <h3>対面</h3><div class="list">${c.matchups.slice(0, 10).map((m) => `<a class="row" href="${link("champions", m.opponent)}"><span>vs ${withChamp(m.opponent, 24)}</span><span class="muted">${m.role}</span><span>${m.wins}勝${m.games - m.wins}敗</span></a>`).join("") || '<p class="muted">対面のデータなし</p>'}</div>`;
}

// ---- 記録 ----
function renderRecords() {
  const r = SITE.records;
  const single = [["kills", "最多キル"], ["deaths", "最多デス"], ["assists", "最多アシスト"], ["damage", "最多ダメージ"], ["cs", "最多CS"]]
    .filter(([k]) => r.single_game[k])
    .map(([k, label]) => { const x = r.single_game[k]; return `<a class="row" href="${link("matches", x.match_id)}"><span>${label}</span><span>${num(x.value)}</span><span class="muted">${esc(x.name)}（${esc(x.champion)}）</span></a>`; }).join("");
  const duo = (list) => list.map((d) => `<div class="row"><span>${esc(d.names.join(" × "))}</span><span class="muted">${d.games}試合</span><span>${pct(d.win_rate)}</span></div>`).join("") || '<p class="muted">該当なし</p>';
  const rival = r.rivals.map((x) => `<div class="row"><span>${esc(x.names[0])} vs ${esc(x.names[1])}</span><span>${x.wins[0]}-${x.wins[1]}</span></div>`).join("") || '<p class="muted">該当なし</p>';
  const streak = (list) => list.map((x) => `<span class="chip">${esc(x.name)} ${x.length}</span>`).join("");
  const rank = (list, fmt) => list.map((x, i) => `<a class="row" href="${link("players", x.name)}"><span>${i + 1}. ${withAvatar(x.name, 24)}</span><span class="muted">${x.games}試合</span><span>${fmt(x.value)}</span></a>`).join("");
  const monthly = r.monthly.slice().reverse().map((m) => `<div class="row"><span>${esc(m.month)}</span><span class="muted">${m.games}試合 Blue${pct(m.blue_win_rate)}</span><span>${m.top.map((t) => esc(t.name)).join("・") || "-"}</span></div>`).join("");
  return `<section class="records"><h2>記録</h2>
    <h3>1試合の記録</h3><div class="list">${single}</div>
    <h3>最強コンビ（同じチームで10試合以上）</h3><div class="list">${duo(r.duos.best)}</div>
    <h3>最凶コンビ</h3><div class="list">${duo(r.duos.worst)}</div>
    <h3>因縁の対決（敵同士で15試合以上）</h3><div class="list">${rival}</div>
    <h3>最長連勝</h3><div class="chips">${streak(r.streaks.win)}</div>
    <h3>最長連敗</h3><div class="chips">${streak(r.streaks.loss)}</div>
    <h3>AIスコア ランキング（10試合以上）</h3><div class="list">${rank(r.rankings.ai, (v) => avgBadge(v))}</div>
    <h3>勝率 ランキング</h3><div class="list">${rank(r.rankings.win_rate, pct)}</div>
    <h3>MVP回数 ランキング</h3><div class="list">${rank(r.rankings.mvp, (v) => `${v}回`)}</div>
    <h3>月ごとの推移</h3><div class="list">${monthly}</div></section>`;
}

start();
