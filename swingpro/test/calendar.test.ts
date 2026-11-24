import { describe, it, expect } from "vitest";
import { sessionFor, isHoliday, lastCompletedSession, hourlyBoundaries } from "../src/calendar";
import { berlinMinusNyHours, nyToUtc, formatBerlin, ny, berlin, iso } from "../src/time";

describe("NYSE-Kalender", () => {
  it("Feiertage 2026/2027 laut nyse.com", () => {
    for (const d of ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
      "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"]) {
      expect(isHoliday(d), d).not.toBeNull();
      expect(sessionFor(d), d).toBeNull();
    }
    expect(sessionFor("2026-07-02")?.early).toBe(false);
    expect(sessionFor("2027-12-31")).not.toBeNull(); // Neujahr 2028 auf Samstag wird nicht beobachtet
  });
  it("verkürzte Sitzungen 13:00", () => {
    expect(sessionFor("2026-11-27")!.early).toBe(true);
    expect(sessionFor("2026-12-24")!.early).toBe(true);
    expect(sessionFor("2027-11-26")!.early).toBe(true);
    expect(sessionFor("2025-07-03")!.early).toBe(true);
    const s = sessionFor("2026-11-27")!;
    expect(ny(s.close).h).toBe(13);
    expect(hourlyBoundaries(s).length).toBe(3); // 10:30, 11:30, 12:30
  });
  it("Sommerzeit: Open 09:30 NY in UTC", () => {
    expect(iso(sessionFor("2026-03-06")!.open)).toBe("2026-03-06T14:30:00.000Z");  // EST
    expect(iso(sessionFor("2026-03-09")!.open)).toBe("2026-03-09T13:30:00.000Z");  // EDT, Berlin noch MEZ
    expect(iso(sessionFor("2026-11-02")!.open)).toBe("2026-11-02T14:30:00.000Z");
  });
  it("Berlin–New York: sonst 6 h, in den Abweichungswochen 5 h", () => {
    expect(berlinMinusNyHours(nyToUtc(2026, 3, 16, 12))).toBe(5);
    expect(berlinMinusNyHours(nyToUtc(2026, 3, 30, 12))).toBe(6);
    expect(berlinMinusNyHours(nyToUtc(2026, 10, 27, 12))).toBe(5);
    expect(berlinMinusNyHours(nyToUtc(2026, 11, 3, 12))).toBe(6);
    expect(berlinMinusNyHours(nyToUtc(2027, 3, 22, 12))).toBe(5);
    expect(berlinMinusNyHours(nyToUtc(2027, 11, 2, 12))).toBe(5);
    expect(berlinMinusNyHours(nyToUtc(2027, 11, 9, 12))).toBe(6);
  });
  it("Berliner Anzeige mit Zeitzone", () => {
    expect(formatBerlin(Date.parse("2026-11-24T16:35:00Z"))).toBe("24.11.2026 17:35 Uhr MEZ");
    expect(berlin(Date.parse("2026-07-01T10:00:00Z")).h).toBe(12);
  });
  it("letzte abgeschlossene Sitzung", () => {
    expect(lastCompletedSession(Date.parse("2026-11-24T16:00:00Z"))).toBe("2026-11-23");
    expect(lastCompletedSession(Date.parse("2026-11-24T21:30:00Z"))).toBe("2026-11-24");
    expect(lastCompletedSession(Date.parse("2026-11-27T17:00:00Z"))).toBe("2026-11-25");  // Thanksgiving, Freitag noch offen
    expect(lastCompletedSession(Date.parse("2026-11-27T19:00:00Z"))).toBe("2026-11-27"); // verkürzter Schluss 13:00
  });
});
