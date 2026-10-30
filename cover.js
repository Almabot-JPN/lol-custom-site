// 表紙（#/）。app.js の SITE・esc・pct・link・champImg・avatar・champion を使う
// 座り込んだちびパンダ（お団子つき）
const PANDA_SVG = `<svg class="panda" viewBox="0 0 600 600" aria-hidden="true">
  <ellipse cx="320" cy="578" rx="230" ry="18" fill="#000" opacity=".22"/>
  <g stroke="#6b5a3e" stroke-width="7" stroke-linecap="round"><line x1="428" y1="586" x2="596" y2="530"/></g>
  <g stroke="#3b8f5a" stroke-width="4">
    <circle cx="474" cy="570" r="25" fill="#b8efc4"/><circle cx="518" cy="556" r="25" fill="#d6f7dc"/>
    <circle cx="562" cy="541" r="25" fill="#b8efc4"/>
  </g>
  <circle cx="140" cy="520" r="30" fill="#fbfaf7"/>
  <ellipse cx="310" cy="440" rx="176" ry="142" fill="#fbfaf7"/>
  <g fill="#343a66">
    <circle cx="146" cy="104" r="58"/><circle cx="454" cy="104" r="58"/>
  </g>
  <g fill="#5d5f8c"><circle cx="146" cy="106" r="28"/><circle cx="454" cy="106" r="28"/></g>
  <ellipse cx="300" cy="238" rx="200" ry="168" fill="#fbfaf7"/>
  <g fill="#9a97b8" opacity=".75">
    <ellipse cx="208" cy="262" rx="60" ry="36" transform="rotate(-6 208 262)"/>
    <ellipse cx="392" cy="262" rx="60" ry="36" transform="rotate(6 392 262)"/>
  </g>
  <g fill="none" stroke="#343a66" stroke-width="8" stroke-linecap="round">
    <path d="M178 266 Q206 284 236 264"/><path d="M364 264 Q394 284 422 266"/>
  </g>
  <g fill="#ffb1c3" opacity=".8"><ellipse cx="176" cy="318" rx="38" ry="22"/><ellipse cx="424" cy="318" rx="38" ry="22"/></g>
  <path d="M286 296 Q300 288 314 296 Q310 310 300 312 Q290 310 286 296 Z" fill="#343a66"/>
  <path d="M300 312 Q292 326 280 320 M300 312 Q308 326 320 320" fill="none" stroke="#343a66" stroke-width="5" stroke-linecap="round"/>
  <g fill="#343a66">
    <ellipse cx="236" cy="420" rx="64" ry="50" transform="rotate(24 236 420)"/>
    <ellipse cx="370" cy="420" rx="64" ry="50" transform="rotate(-24 370 420)"/>
    <ellipse cx="226" cy="534" rx="56" ry="44"/><ellipse cx="378" cy="534" rx="56" ry="44"/>
  </g>
  <g fill="#9a97b8">
    <ellipse cx="226" cy="544" rx="22" ry="16"/><circle cx="200" cy="514" r="8"/><circle cx="226" cy="506" r="8"/><circle cx="252" cy="514" r="8"/>
    <ellipse cx="378" cy="544" rx="22" ry="16"/><circle cx="352" cy="514" r="8"/><circle cx="378" cy="506" r="8"/><circle cx="404" cy="514" r="8"/>
  </g>
</svg>`;

function coverFacts() {
  const ms = SITE.matches;                                     // 新しい順
  const kills = ms.reduce((s, m) => s + m.players.reduce((t, x) => t + x.k, 0), 0);
  const dates = ms.map((m) => m.date).sort();
  const fmt = (d) => (d ? d.replaceAll("-", "/") : "-");
  return { games: SITE.summary.games, players: SITE.summary.players, kills,
           from: fmt(dates[0]), to: fmt(dates[dates.length - 1]) };
}

function splashUrl(name) {
  const id = SITE.champion_ids && SITE.champion_ids[name];
  return id ? `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${id}_0.jpg` : null;
}

function coverCard(kind, title, body, href, splash) {
  const bg = splash ? ` style="background-image:linear-gradient(180deg,rgba(20,14,48,.15),rgba(20,14,48,.92) 70%),url('${splash}')"` : "";
  return `<a class="cover-card ${kind}" href="${href}"${bg}><span class="kind">${title}</span>${body}</a>`;
}

// 一番新しい開催日のまとめ（自動の数字と、あれば Claude が書いた振り返り）
function renderSession(s) {
  if (!s) return "";
  const who = (name) => `<a href="${link("players", name)}">${esc(name)}</a>`;
  const signed = (d) => `${d >= 0 ? "+" : ""}${d}pt`;
  const items = [
    s.mvp.length ? ["MVP", s.mvp.map((m) => `${who(m.name)}${m.count > 1 ? ` ×${m.count}` : ""}`).join("・")] : null,
    s.top_ai ? ["平均AI 1位", `${who(s.top_ai.name)} ${s.top_ai.avg.toFixed(1)}（${s.top_ai.games}試合）`] : null,
    ["最多キル", `${who(s.top_kills.name)} ${s.top_kills.k}キル（${esc(s.top_kills.champion)}）`],
    s.points_up ? ["ポイント上昇", `${who(s.points_up.name)} ${signed(s.points_up.delta)}`] : null,
    s.newcomers.length ? ["初参加", s.newcomers.map(who).join("・")] : null,
  ].filter(Boolean);
  const note = s.note ? s.note.split(/\n\s*\n/).map((t) => `<p class="session-note">${esc(t.trim())}</p>`).join("") : "";
  return `<section class="cover-session">
    <div class="session-head"><span class="label">最新の開催</span>
      <strong>${esc(s.date.replaceAll("-", "/"))}</strong>
      <span class="games">${s.games}試合（Blue ${s.blue_wins}勝・Red ${s.red_wins}勝）</span></div>
    ${note}
    <dl class="session-items">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
  </section>`;
}

// 一番新しい月の総評（Claude が書いた文章）。空行で段落を分ける
function renderMonthly(m) {
  if (!m || !m.text) return "";
  const [y, mo] = m.month.split("-");
  const body = m.text.split(/\n\s*\n/).map((t) => `<p>${esc(t.trim())}</p>`).join("");
  return `<section class="cover-month"><h2><span>${Number(y)}年${Number(mo)}月の総評</span></h2>${body}</section>`;
}

function renderCover() {
  const f = coverFacts();
  const duo = SITE.records.duos.best[0];
  const pick = [...SITE.champions].sort((a, b) => b.picks - a.picks)[0];
  const kill = SITE.records.single_game.kills;
  const cards = [
    duo ? coverCard("duo", "最強コンビ",
      `<span class="faces">${avatar(duo.names[0], 56)}${avatar(duo.names[1], 56)}</span>
       <strong>${esc(duo.names.join(" × "))}</strong><span class="sub">${duo.games}試合で勝率 ${pct(duo.win_rate)}</span>`,
      link("players", duo.names[0]), null) : "",
    pick ? coverCard("pick", "いちばん選ばれたチャンピオン",
      `<strong>${esc(pick.name)}</strong><span class="sub">${pick.picks}回ピック・勝率 ${pick.picks ? pct(pick.win_rate) : "-"}</span>`,
      link("champions", pick.name), splashUrl(pick.name)) : "",
    kill ? coverCard("kill", "1試合の最多キル",
      `<strong class="big">${kill.value}<small>キル</small></strong><span class="sub">${esc(kill.name)}（${esc(kill.champion)}）</span>`,
      link("matches", kill.match_id), null) : "",
  ].join("");
  const doors = [["players", "プレイヤー"], ["matches", "試合"], ["champions", "チャンピオン"], ["tier", "tier"], ["records", "記録"]]
    .map(([tab, label]) => `<a href="#/${tab}">${label}</a>`).join("");
  return `<section class="cover">
    <div class="cover-hero">
      <div class="cover-bg">${PANDA_SVG}</div>
      <h1><span>RUTOHA</span> <span>CUSTOM</span> <span>RESULT</span></h1>
      <p class="tagline">るとはのカスタム戦績</p>
      <dl class="cover-stats">
        <div><dt>試合</dt><dd class="count" data-key="games" data-to="${f.games}">0</dd></div>
        <div><dt>参加者</dt><dd class="count" data-key="players" data-to="${f.players}">0</dd></div>
        <div><dt>総キル</dt><dd class="count" data-key="kills" data-to="${f.kills}">0</dd></div>
        <div><dt>開催期間</dt><dd class="period">${f.from}<br>〜 ${f.to}</dd></div>
      </dl>
    </div>
    ${renderSession(SITE.latest_session)}
    ${renderMonthly(SITE.monthly_note)}
    <div class="cover-cards">${cards}</div>
    <div class="cover-doors">${doors}</div>
  </section>`;
}

// 開いたときの一度だけの動き: 数字のカウントアップ（動きを減らす設定なら即座に最終値）
function startCover(root) {
  const counts = [...root.querySelectorAll(".count")];
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const show = (el, v) => { el.textContent = Math.round(v).toLocaleString("ja-JP"); };
  if (reduce) { counts.forEach((el) => show(el, Number(el.dataset.to))); return; }
  const start = performance.now(), ms = 1400;
  const tick = (now) => {
    const t = Math.min((now - start) / ms, 1), e = 1 - Math.pow(1 - t, 3);
    counts.forEach((el) => show(el, Number(el.dataset.to) * e));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
