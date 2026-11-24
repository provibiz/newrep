import { describe, it, expect } from "vitest";
import { createDb, cfgOf, makeDeps, FakeAlpaca, hourlyToRaw30 } from "./helpers";
import { T, hourlyBars } from "../src/replay/scenario";
import { runHourly } from "../src/jobs/hourly";
import { upsert } from "../src/store";
import type { Db } from "../src/store";

/** Zählt D1-Abfragen so, wie Cloudflare es tut: ein batch() zählt als eine Abfrage. */
function counting(db: Db) {
  let n = 0, inBatch = false;
  const wrap = (s: any): any => ({ bind: (...a: unknown[]) => wrap(s.bind(...a)), run: () => { if (!inBatch) n++; return s.run(); }, first: () => { if (!inBatch) n++; return s.first(); }, all: () => { if (!inBatch) n++; return s.all(); } });
  return { db: { prepare: (q: string) => wrap(db.prepare(q)), batch: async (ss: any[]) => { n++; inBatch = true; try { return await db.batch(ss); } finally { inBatch = false; } } } as Db, count: () => n };
}

describe("Skalierung: Subrequest-Budget je Aufruf (Workers Paid: 1000)", () => {
  it("Stundenscan für 400 Titel bleibt weit unter 1000 D1-Abfragen und wenigen Datenabrufen; zweiter Lauf lädt nur inkrementell", async () => {
    const base = createDb(), { db, count } = counting(base), a = new FakeAlpaca();
    const bars = hourlyBars("flat", T.boundary, 70, 50);
    const before = bars.slice(0, -1);
    const syms = Array.from({ length: 400 }, (_, i) => "S" + String(i).padStart(3, "0"));
    for (const s of syms) { a.raw30.set(s, hourlyToRaw30(bars)); await upsert(base, "metrics", "symbol", { symbol: s, asof: "2026-11-23", price: 50, adv_usd: 1e8, range_pct: 3, ret63: 0.1, rs_pct: 80, passed: 1, reason: null, updated_at: 1 }); }
    a.raw30.set("QQQ", hourlyToRaw30(hourlyBars("up", T.boundary)));
    const d = makeDeps(db, cfgOf(), T.hourly, { alpaca: a });
    expect(await runHourly(d)).toMatch(/ok: 400 geprüft/);
    expect(count()).toBeLessThan(150);
    expect(a.calls.length).toBeLessThanOrEqual(10);
    // zweiter Stundenlauf eine Stunde später: Abruf beginnt am letzten gespeicherten Wert, nicht bei der 16-Tage-Historie
    const next = T.boundary + 3_600_000;
    for (const sy of [...syms, "QQQ"]) a.raw30.set(sy, hourlyToRaw30(hourlyBars(sy === "QQQ" ? "up" : "flat", next, 71, 50)));
    a.calls.length = 0; a.starts.length = 0;
    d.clock.t = next + 6 * 60_000;
    expect(await runHourly(d)).toMatch(/ok: 400 geprüft/);
    expect(a.starts.every((st) => Date.parse(st.split("|")[1]) > T.boundary - 2 * 86_400_000)).toBe(true);
  });
});
