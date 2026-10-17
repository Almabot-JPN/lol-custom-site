// チーム分け（#/teams）。app.js の SITE・esc・num・avatar・pointsLabel・$ を使う
const TEAM_ROLES = ["TOP", "JG", "MID", "BOT", "SUP"];
const OFF_ROLE_PENALTY = 150;
const GUEST_RANKS = [..."IBSGPED"].flatMap((t) => [4, 3, 2, 1].map((d) => `${t}${d}`)).concat(["M1", "HM1", "GM1", "C1"]);
const teamsState = { selected: [], guests: [], mode: "team", prefs: {}, candidates: [], idx: 0, message: "" };

// 登録ランク → 初期ポイント（Python の points.initial_points と同じ）
function rankPoints(rank) {
  const r = String(rank || "").trim().toUpperCase();
  if (r === "HM1") return 3300;
  if (r.startsWith("GM")) return 3800;
  if (/^C\d$/.test(r)) return 4100;
  if (r.startsWith("M")) return 2800;
  const t = "IBSGPED".indexOf(r[0]), d = Number(r.slice(1));
  if (t < 0 || !d) return 2400;
  return (t * 4 + (4 - Math.min(Math.max(d, 1), 4))) * 100;
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}
const ROLE_PERMS = permutations([0, 1, 2, 3, 4]);

// 1チームの全割り当て（ロール順の並び）: [{sum, off, roles: [ロール名×5]}]
function teamAssignments(team) {
  return ROLE_PERMS.map((perm) => {
    let sum = 0, off = 0;
    const roles = perm.map((ri, k) => {
      const m = team[k], role = TEAM_ROLES[ri];
      sum += m.role_points[role];
      if (m.prefs.length && !m.prefs.includes(role)) off += 1;
      return role;
    });
    return { sum, off, roles };
  });
}

// members: [{name, points, role_points, prefs}] 10人。mode: "team" | "role"。評価の良い順に最大3案
function splitTeams(members, mode) {
  const out = [];
  const idx = members.map((_, i) => i);
  const combos = [];
  const pick = (start, chosen) => {
    if (chosen.length === 5) { combos.push(chosen); return; }
    for (let i = start; i < members.length; i++) pick(i + 1, [...chosen, i]);
  };
  pick(1, [0]);                                      // 0番を必ず含める（Blue/Red の入れ替えを重複させない）
  for (const c of combos) {
    const a = c.map((i) => members[i]), b = idx.filter((i) => !c.includes(i)).map((i) => members[i]);
    if (mode === "role") {
      const A = teamAssignments(a), B = teamAssignments(b);
      let best = null;
      for (const x of A) for (const y of B) {
        const score = Math.abs(x.sum - y.sum) + OFF_ROLE_PENALTY * (x.off + y.off);
        if (!best || score < best.score) best = { score, x, y };
      }
      const tag = (team, asg) => team.map((m, k) => ({ name: m.name, role: asg.roles[k], points: m.role_points[asg.roles[k]],
        off: m.prefs.length > 0 && !m.prefs.includes(asg.roles[k]) }))
        .sort((p, q) => TEAM_ROLES.indexOf(p.role) - TEAM_ROLES.indexOf(q.role));
      out.push({ a: tag(a, best.x), b: tag(b, best.y), aSum: best.x.sum, bSum: best.y.sum,
                 offRole: best.x.off + best.y.off, score: best.score });
    } else {
      const sa = a.reduce((s, m) => s + m.points, 0), sb = b.reduce((s, m) => s + m.points, 0);
      const plain = (team) => team.map((m) => ({ name: m.name, points: m.points })).sort((p, q) => q.points - p.points);
      out.push({ a: plain(a), b: plain(b), aSum: sa, bSum: sb, offRole: 0, score: Math.abs(sa - sb) });
    }
  }
  out.sort((p, q) => p.score - q.score);
  return out.slice(0, 3).map((c) => {
    const swap = c.aSum < c.bSum;                    // 合計の高いほうを Blue
    return { blue: swap ? c.b : c.a, red: swap ? c.a : c.b, blueSum: Math.max(c.aSum, c.bSum),
             redSum: Math.min(c.aSum, c.bSum), diff: Math.abs(c.aSum - c.bSum), offRole: c.offRole, score: c.score };
  });
}

function teamsText(c, mode) {
  const line = (m) => `${mode === "role" ? m.role + " " : ""}${m.name} ${num(m.points)}${m.off ? "（希望外）" : ""}`;
  return [`【Blue】合計 ${num(c.blueSum)}pt`, ...c.blue.map(line), "", `【Red】合計 ${num(c.redSum)}pt`, ...c.red.map(line),
          "", `差 ${num(c.diff)}pt`].join("\n");
}

// ---- 画面 ----
function teamPool() {
  const real = SITE.players.map((p) => ({ name: p.name, points: p.points, role_points: p.role_points, games: p.games,
    defaultPrefs: [...p.roles].sort((x, y) => y.games - x.games).slice(0, 2).map((r) => r.role) }));
  const guests = teamsState.guests.map((g) => ({ ...g, games: 0, defaultPrefs: [], guest: true }));
  return [...real.sort((x, y) => y.games - x.games), ...guests];
}
function selectedMembers() {
  const pool = teamPool();
  return teamsState.selected.map((n) => pool.find((p) => p.name === n)).filter(Boolean)
    .map((p) => ({ name: p.name, points: p.points, role_points: p.role_points,
                   prefs: teamsState.prefs[p.name] ?? p.defaultPrefs }));
}
const rerenderTeams = () => { $("#view").innerHTML = renderTeams(); };

function toggleTeamPick(name) {
  const s = teamsState.selected;
  teamsState.selected = s.includes(name) ? s.filter((n) => n !== name) : [...s, name];
  teamsState.candidates = [];
  rerenderTeams();
}
function addGuest() {
  const name = $("#guest-name").value.trim(), rank = $("#guest-rank").value;
  if (!name || teamPool().some((p) => p.name === name)) {
    teamsState.message = name ? `「${name}」はもういます` : "ゲストの名前を入れてください";
    rerenderTeams();
    return;
  }
  const pts = rankPoints(rank);
  teamsState.guests.push({ name, rank, points: pts, role_points: Object.fromEntries(TEAM_ROLES.map((r) => [r, pts])) });
  teamsState.selected.push(name);
  teamsState.message = "";
  teamsState.candidates = [];
  rerenderTeams();
}
function removeGuest(name) {
  teamsState.guests = teamsState.guests.filter((g) => g.name !== name);
  teamsState.selected = teamsState.selected.filter((n) => n !== name);
  delete teamsState.prefs[name];
  teamsState.candidates = [];
  rerenderTeams();
}
function setTeamMode(mode) { teamsState.mode = mode; teamsState.candidates = []; rerenderTeams(); }
function togglePref(name, role) {
  const cur = teamsState.prefs[name] ?? (selectedMembers().find((m) => m.name === name) || { prefs: [] }).prefs;
  teamsState.prefs[name] = cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role];
  teamsState.candidates = [];
  rerenderTeams();
}
function runSplit() {
  teamsState.candidates = splitTeams(selectedMembers(), teamsState.mode);
  teamsState.idx = 0;
  rerenderTeams();
}
function nextPlan() { teamsState.idx = (teamsState.idx + 1) % teamsState.candidates.length; rerenderTeams(); }
function copyTeams() {
  const text = teamsText(window.__teamsCurrent, teamsState.mode);
  const fallback = () => { $("#copy-text").hidden = false; $("#copy-text").value = text; $("#copy-text").select(); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => { $("#copy").textContent = "コピーしました"; }, fallback);
  else fallback();
}

function renderTeams() {
  const n = teamsState.selected.length;
  const status = n === 10 ? "10/10人 そろいました" : n < 10 ? `${n}/10人（あと${10 - n}人選んでください）` : `${n}/10人（${n - 10}人多いです）`;
  const picks = teamPool().map((p) => {
    const arg = esc(JSON.stringify(p.name));
    const btn = `<button type="button" class="${teamsState.selected.includes(p.name) ? "on" : ""}"
      onclick="toggleTeamPick(${arg})">${avatar(p.name, 24)}<span>${esc(p.name)}</span></button>`;
    return p.guest ? `<span class="guest-chip">${btn}<button type="button" class="guest-remove"
      aria-label="${esc(p.name)}を外す" title="ゲストを外す" onclick="removeGuest(${arg})">×</button></span>` : btn;
  }).join("");
  const rankOpts = GUEST_RANKS.map((r) => `<option value="${r}"${r === "D4" ? " selected" : ""}>${r}</option>`).join("");
  const modeBtn = (m, label) => `<button type="button" class="${teamsState.mode === m ? "on" : ""}" onclick="setTeamMode('${m}')">${label}</button>`;
  const prefs = teamsState.mode === "role" && n > 0 ? `<h3>希望ロール <span class="muted">（何も選ばなければどこでも）</span></h3>
    <div class="prefs">${selectedMembers().map((m) => `<div class="pref-row"><span class="who">${avatar(m.name, 20)}<span class="nm">${esc(m.name)}</span></span>
      <span class="chips">${TEAM_ROLES.map((r) => `<button type="button" class="${m.prefs.includes(r) ? "on" : ""}"
        onclick="togglePref(${esc(JSON.stringify(m.name))}, '${r}')">${r}</button>`).join("")}</span></div>`).join("")}</div>` : "";
  return `<h2>チーム分け</h2>
    <p class="muted">10人選ぶと、ポイントの合計が近くなるように2チームに分けます。</p>
    <div class="team-picker">${picks}</div>
    <div class="guest"><input id="guest-name" placeholder="ゲストの名前" maxlength="20">
      <select id="guest-rank" aria-label="ゲストのランク">${rankOpts}</select>
      <button type="button" id="guest-add" onclick="addGuest()">ゲストを追加</button></div>
    ${teamsState.message ? `<p class="error">${esc(teamsState.message)}</p>` : ""}
    <p class="pick-status">${status}</p>
    <div class="mode">${modeBtn("team", "チームだけ")}${modeBtn("role", "ロールも決める")}</div>
    ${prefs}
    <button type="button" id="split" class="split" onclick="runSplit()" ${n === 10 ? "" : "disabled"}>チームを分ける</button>
    ${renderTeamResult()}`;
}

function renderTeamResult() {
  const cs = teamsState.candidates;
  if (!cs.length) return "";
  const c = cs[teamsState.idx];
  window.__teamsCurrent = c;
  const role = teamsState.mode === "role";
  const team = (side, label, members, sum) => `<div class="team ${side}"><h3>${label} <span>${num(sum)}pt</span></h3>
    ${members.map((m) => `<div class="member">${role ? `<span class="role">${m.role}</span>` : ""}
      <span class="who">${avatar(m.name, 28)}<span class="nm">${esc(m.name)}</span></span>
      ${m.off ? '<span class="off">希望外</span>' : ""}<span class="pts">${num(m.points)}</span></div>`).join("")}</div>`;
  return `<section class="team-result">
    <div class="teams">${team("blue", "Blue", c.blue, c.blueSum)}${team("red", "Red", c.red, c.redSum)}</div>
    <p class="diff">差 ${num(c.diff)}pt${role && c.offRole ? `（希望外 ${c.offRole}人）` : ""}</p>
    <div class="result-actions"><span class="plan-no">案 ${teamsState.idx + 1}/${cs.length}</span>
      <button type="button" id="next-plan" onclick="nextPlan()">別の案</button>
      <button type="button" id="copy" onclick="copyTeams()">コピー</button></div>
    <textarea id="copy-text" hidden readonly rows="14"></textarea>
  </section>`;
}
