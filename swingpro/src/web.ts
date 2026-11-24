/** HTTP: geschützte Statusansicht, Bestätigungs-Links (GET zeigt nur ein Formular, nur POST ändert Zustand), Admin-Aktionen. */
import type { Deps } from "./deps";
import { all, getMeta, one } from "./store";
import { lookupToken, createToken } from "./tokens";
import { confirmBuy, skipTrade, recordSale, positionSummary, ActionError, getPosition } from "./actions";
import { formatBerlin, DAY, MIN } from "./time";
import { remaining, partialTarget, rPerShare } from "./positions";
import { toPosition } from "./jobs/positions";
import { runProbe, type ProbeResult } from "./jobs/probe";
import { enqueue, flushOutbox } from "./outbox";
import { runDaily } from "./jobs/daily";
import { runHourly } from "./jobs/hourly";
import { runIntraday } from "./jobs/intraday";
import { SETUP_LABEL } from "./types";
import { lastCompletedSession } from "./calendar";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const HEAD = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" };
const page = (title: string, body: string, status = 200) => new Response(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:16px/1.45 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:16px;color:#1a1a1a}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;font-size:14px}.ok{color:#0a7a2f}.bad{color:#b00020}.warn{color:#a65f00}label{display:block;margin:10px 0 2px}input,select{font:inherit;padding:8px;width:100%;box-sizing:border-box}button{font:inherit;padding:10px 16px;margin-top:14px;border:0;background:#0b57d0;color:#fff;border-radius:6px}button.sec{background:#666}code{background:#eee;padding:1px 4px}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}td,th{border-color:#333}code{background:#222}}</style><body>${body}</body></html>`, { status, headers: HEAD });

function authed(req: Request, d: Deps, env: { STATUS_TOKEN?: string }): boolean {
  const want = env.STATUS_TOKEN;
  if (!want || want.length < 16) return false;
  const h = req.headers.get("authorization") ?? "";
  let given = "";
  if (h.startsWith("Bearer ")) given = h.slice(7);
  else if (h.startsWith("Basic ")) { try { given = atob(h.slice(6)).split(":").slice(1).join(":"); } catch { /* ignore */ } }
  return timingSafeEqual(given, want);
}
function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
const unauth = () => new Response("Anmeldung erforderlich", { status: 401, headers: { "www-authenticate": 'Basic realm="SwingPro Status"' } });

export async function handleRequest(req: Request, d: Deps, env: { STATUS_TOKEN?: string }): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  if (p === "/healthz") return new Response("ok");
  if (p.startsWith("/a/")) return actionPage(req, d, p.slice(3));
  if (!authed(req, d, env)) return unauth();
  const origin = req.headers.get("origin");
  if (req.method === "POST" && origin && origin !== url.origin) return new Response("Cross-Site-Anfrage abgelehnt", { status: 403 });
  if (p === "/" || p === "/status") return statusPage(d);
  if (p === "/status.json") return new Response(JSON.stringify(await statusData(d), null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (req.method === "POST" && p === "/admin/probe") { await runProbe(d); return Response.redirect(url.origin + "/status", 303); }
  if (req.method === "POST" && p === "/admin/test-mail") {
    await enqueue(d, { id: `test:${d.now()}`, kind: "test", subject: "SwingPro · Testmail", text: `Testmail ${formatBerlin(d.now())}\nWenn du das liest, hat Resend die Mail angenommen. Die Zustellzeit wird nicht gemessen.` });
    const r = await flushOutbox(d);
    return page("Testmail", `<p>Versandversuch: ${esc(JSON.stringify(r))}</p><p><a href="/status">Status</a></p>`);
  }
  if (req.method === "POST" && p.startsWith("/admin/run/")) {
    const job = p.slice("/admin/run/".length);
    const fn = job === "daily" ? runDaily : job === "hourly" ? runHourly : job === "intraday" ? runIntraday : null;
    if (!fn) return new Response("unbekannter Job", { status: 404 });
    return page("Lauf", `<p>${esc(await fn(d))}</p><p><a href="/status">Status</a></p>`);
  }
  return new Response("nicht gefunden", { status: 404 });
}

export async function statusData(d: Deps) {
  const now = d.now();
  const lastOk = async (k: string) => getMeta<{ at: number; stats: any }>(d.db, `last_ok:${k}`);
  const [hourly, intraday, daily, probe, universe] = await Promise.all([lastOk("hourly"), lastOk("intraday"), lastOk("daily"), getMeta<ProbeResult>(d.db, "probe"), getMeta<any>(d.db, "universe_stats")]);
  const runs = await all<any>(d.db, "SELECT kind, status, started_at, finished_at, error, stats FROM scan_runs ORDER BY id DESC LIMIT 15");
  const errors = await all<any>(d.db, "SELECT ts, scope, message FROM errors ORDER BY id DESC LIMIT 15");
  const outbox = await all<any>(d.db, "SELECT state, COUNT(*) n FROM outbox GROUP BY state");
  const lastMail = await all<any>(d.db, "SELECT id, kind, subject, state, created_at, accepted_at, error FROM outbox ORDER BY created_at DESC LIMIT 10");
  const signals = await all<any>(d.db, "SELECT id, symbol, setups, signal_time, status, status_reason, observed_price, quote_time, checked_at, shares, mode, feed FROM signals ORDER BY signal_time DESC LIMIT 15");
  const prepared = await all<any>(d.db, "SELECT state, COUNT(*) n FROM prepared GROUP BY state");
  const positions = await all<any>(d.db, "SELECT id, symbol, status, entry, shares, shares_sold, stop, needs_review FROM positions WHERE status IN ('pending','open')");
  const lastBar = await one<{ m: number }>(d.db, "SELECT MAX(last_end) m FROM series WHERE tf='1h'");
  return {
    now, mode: d.cfg.mode, feed: d.cfg.feed, dailyFeed: d.cfg.dailyFeed, lastCompletedSession: lastCompletedSession(now, 20),
    lastOk: { hourly, intraday, daily },
    dataAgeMin: lastBar?.m ? Math.round((now - lastBar.m) / MIN) : null,
    universe, probe, runs, errors, outbox, lastMail, signals, prepared, positions,
    note: "accepted_at = Annahme durch Resend; die Zustellung im Postfach wird nicht gemessen.",
  };
}

async function statusPage(d: Deps): Promise<Response> {
  const s = await statusData(d);
  const t = (x: number | null | undefined) => (x ? formatBerlin(x) : "–");
  const row = (label: string, v: any, warnAfterMin?: number) => {
    const age = v?.at ? Math.round((s.now - v.at) / MIN) : null;
    return `<tr><td>${label}</td><td>${t(v?.at)}${age !== null ? ` <small>(vor ${age} Min)</small>` : ""}</td></tr>`;
  };
  const u = s.universe;
  const body = `<h1>SwingPro Status</h1>
<p><b>Modus:</b> ${esc(s.mode)} · <b>Feed:</b> ${esc(s.feed)} (Tageskerzen: ${esc(s.dailyFeed)}) · Stand ${t(s.now)}</p>
<p class="${s.dataAgeMin !== null && s.dataAgeMin > 120 ? "warn" : "ok"}">Alter der jüngsten Stundenkerze: ${s.dataAgeMin ?? "–"} Min (über Nacht/Wochenende normal)</p>
<h2>Letzte erfolgreiche Läufe</h2><table>${row("Tageslauf", s.lastOk.daily)}${row("Stundenscan", s.lastOk.hourly)}${row("5-Minuten-Überwachung", s.lastOk.intraday)}</table>
<p>Letzte abgeschlossene Sitzung: ${esc(s.lastCompletedSession)}. „Keine Signale“ ist nur glaubwürdig, wenn diese Läufe aktuell sind.</p>
<h2>Universum</h2>${u ? `<p>${u.available} verfügbar · ${u.excluded} ausgeschlossen · ${u.dataGaps} Datenlücken · ${u.passedLiquidity} liquide · <b>${u.watch} geprüft</b> (Stand ${esc(u.asof)})</p><p><small>${esc(Object.entries(u.excludedByReason).map(([k, v]) => `${k}: ${v}`).join(" · "))}</small></p>` : "<p>Noch kein Tageslauf.</p>"}
<h2>Berechtigungen</h2>${s.probe ? `<table>${(["alpacaAuth", "iexRealtime", "sipHistorical", "sipRealtime", "fmpIncome", "fmpEarnings", "fred"] as const).map((k) => `<tr><td>${k}</td><td class="${s.probe![k].ok ? "ok" : "bad"}">${s.probe![k].ok ? "ok" : "nein"}</td><td>${esc(s.probe![k].detail)}</td></tr>`).join("")}</table><p>${s.probe.summary.map(esc).join("<br>")}</p><small>Stand ${t(s.probe.at)}</small>` : "<p>Noch nicht geprüft.</p>"}
<form method="post" action="/admin/probe"><button class="sec">Berechtigungen neu prüfen</button></form>
<h2>Fehler</h2>${s.errors.length ? `<table>${s.errors.map((e: any) => `<tr><td>${t(e.ts)}</td><td>${esc(e.scope)}</td><td>${esc(e.message)}</td></tr>`).join("")}</table>` : "<p class='ok'>keine</p>"}
<h2>Mails (${s.outbox.map((o: any) => `${o.n}× ${o.state}`).join(", ") || "keine"})</h2><table>${s.lastMail.map((m: any) => `<tr><td>${t(m.created_at)}</td><td>${esc(m.kind)}</td><td>${esc(m.subject)}</td><td>${esc(m.state)}${m.accepted_at ? ` (angenommen ${t(m.accepted_at)})` : ""}${m.error ? " – " + esc(m.error) : ""}</td></tr>`).join("")}</table>
<form method="post" action="/admin/test-mail"><button class="sec">Testmail senden</button></form>
<h2>Läufe von Hand anstoßen</h2><form method="post" action="/admin/run/daily"><button class="sec">Tageslauf</button></form><form method="post" action="/admin/run/hourly"><button class="sec">Stundenscan</button></form><form method="post" action="/admin/run/intraday"><button class="sec">5-Minuten-Überwachung</button></form>
<h2>Signale</h2><table>${s.signals.map((x: any) => `<tr><td>${t(x.signal_time)}</td><td>${esc(x.symbol)}</td><td>${esc(JSON.parse(x.setups).map((k: keyof typeof SETUP_LABEL) => SETUP_LABEL[k]).join(" + "))}</td><td>${esc(x.status)}</td><td>${x.observed_price ?? ""}</td></tr>`).join("") || "<tr><td>keine</td></tr>"}</table>
<p>Vorbereitete Setups: ${s.prepared.map((p: any) => `${p.n}× ${p.state}`).join(", ") || "keine"}</p>
<h2>Positionen</h2>${s.positions.map((p: any) => `<p>${esc(p.symbol)} · ${esc(p.status)} · Stopp ${p.stop ?? "–"}${p.needs_review ? " · <b class=bad>Split/Anpassung prüfen</b>" : ""}</p>`).join("") || "<p>keine offenen</p>"}
<h2>Letzte Läufe</h2><table>${s.runs.map((r: any) => `<tr><td>${t(r.started_at)}</td><td>${esc(r.kind)}</td><td class="${r.status === "ok" ? "ok" : r.status === "failed" ? "bad" : "warn"}">${esc(r.status)}</td><td>${esc(r.error ?? "")}</td></tr>`).join("")}</table>
<p><small>JSON: <a href="/status.json">/status.json</a></small></p>`;
  return page("SwingPro Status", body);
}

// ───────── Aktions-Links ─────────
async function actionPage(req: Request, d: Deps, raw: string): Promise<Response> {
  const tok = await lookupToken(d.db, d.pepper, raw, d.now());
  if (!tok) return page("Link ungültig", "<p>Dieser Link ist abgelaufen oder ungültig.</p>", 404);
  const posId = tok.purpose === "buy" ? `pos|${tok.ref_id}` : tok.ref_id;
  if (req.method === "POST") {
    const f = await req.formData();
    const get = (k: string) => String(f.get(k) ?? "");
    const requestId = get("request_id");
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId) || get("confirm") !== "yes") return page("Fehler", "<p>Ausdrückliche Bestätigung fehlt.</p>", 400);
    try {
      const action = get("action");
      if (action === "buy") { const r = await confirmBuy(d, posId, { price: get("price"), shares: get("shares"), fees: get("fees"), requestId }); return result(r.already ? "Kauf war bereits erfasst" : "Kauf erfasst. Die Begleitung läuft.", r.position); }
      if (action === "skip") { await skipTrade(d, posId, requestId); return result("Als ausgelassen erfasst."); }
      if (action === "partial" || action === "exit") { const r = await recordSale(d, posId, { price: get("price"), shares: get("shares"), fees: get("fees"), kind: action, requestId, note: get("note") || undefined }); return result(r.already ? "Verkauf war bereits erfasst" : action === "exit" ? "Ausstieg erfasst." : "Teilverkauf erfasst.", r.position); }
      return page("Fehler", "<p>Unbekannte Aktion.</p>", 400);
    } catch (e) {
      if (e instanceof ActionError) return page("Eingabe prüfen", `<p class="bad">${esc(e.message)}</p><p>Mit „Zurück“ korrigieren.</p>`, 422);
      throw e;
    }
  }
  // GET: nur anzeigen, nichts speichern (Mail-Scanner rufen Links automatisch auf)
  const pos = await getPosition(d, posId);
  if (!pos) return page("Nicht gefunden", "<p>Position unbekannt.</p>", 404);
  const rid = crypto.randomUUID().replace(/-/g, "");
  const hidden = `<input type="hidden" name="request_id" value="${rid}"><input type="hidden" name="confirm" value="yes">`;
  const cur = d.cfg.accountCurrency === "EUR" ? " (USD, Handelswährung)" : " (USD)";
  const sum = await positionSummary(d, posId);
  if (pos.status === "pending") {
    return page("Kauf bestätigen", `<h1>${esc(pos.symbol)}: Kauf bestätigen</h1><p>Vorschlag: ${pos.shares} Stück, Stopp ${pos.initial_stop}. Es wird erst gespeichert, wenn du unten bestätigst.</p>
<form method="post">${hidden}<input type="hidden" name="action" value="buy">
<label>Tatsächlicher Kaufkurs${cur}</label><input name="price" inputmode="decimal" required value="${pos.entry ?? ""}">
<label>Tatsächliche Stückzahl</label><input name="shares" inputmode="numeric" required value="${pos.shares ?? ""}">
<label>Gebühren${cur}</label><input name="fees" inputmode="decimal" value="0">
<button>Ich habe tatsächlich gekauft – speichern</button></form>
<form method="post">${hidden}<input type="hidden" name="action" value="skip"><button class="sec">Ausgelassen (nicht gekauft)</button></form>`);
  }
  if (pos.status === "open") {
    const pp = toPosition(pos), tgt = partialTarget(d.cfg, pp);
    return page("Position", `<h1>${esc(pos.symbol)}: Position</h1><p>Einstieg ${pos.entry} · ${remaining(pp)} von ${pos.shares} Stück · Stopp ${pos.stop} · 1R = ${rPerShare(pp).toFixed(2)} · Teilverkauf-Marke ${tgt.price.toFixed(2)} (${tgt.shares} Stück)${pos.partial_recommended_at ? " · <b>Teilverkauf empfohlen am " + formatBerlin(pos.partial_recommended_at) + "</b>" : ""}</p>
<h2>Teilverkauf erfassen (tatsächlich ausgeführt)</h2><form method="post">${hidden}<input type="hidden" name="action" value="partial">
<label>Verkaufskurs${cur}</label><input name="price" inputmode="decimal" required><label>Stückzahl</label><input name="shares" inputmode="numeric" required value="${tgt.shares}"><label>Gebühren</label><input name="fees" value="0"><button>Teilverkauf speichern</button></form>
<h2>Manueller Ausstieg (Rest)</h2><form method="post">${hidden}<input type="hidden" name="action" value="exit">
<label>Verkaufskurs${cur}</label><input name="price" inputmode="decimal" required><label>Stückzahl (leer = alles)</label><input name="shares" inputmode="numeric" value="${remaining(pp)}"><label>Gebühren</label><input name="fees" value="0"><label>Notiz</label><input name="note"><button>Ausstieg speichern</button></form>`);
  }
  const pnl = sum?.pnlTotal;
  return page("Position", `<h1>${esc(pos.symbol)}: ${esc(pos.status)}</h1>${pnl !== null && pnl !== undefined ? `<p>Realisiert (nur ausgeführte Verkäufe, nach Gebühren): ${pnl.toFixed(2)} USD${sum && d.cfg.accountCurrency === "EUR" ? ` ≈ ${sum.pnlAccount!.toFixed(2)} EUR (Kurs ${d.cfg.fxUsdPerEur}, ${esc(d.cfg.fxDate)})` : ""}</p>` : ""}`);
  function result(msg: string, position?: any) {
    return page("Gespeichert", `<h1>${esc(msg)}</h1>${position?.status === "open" ? `<p>Einstieg ${position.entry}, Stopp ${position.stop}, Stückzahl ${position.shares - position.shares_sold}.</p>` : ""}`);
  }
}
export { createToken, DAY };
