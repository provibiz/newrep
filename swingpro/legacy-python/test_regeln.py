"""Offline-Prüfung der Muster und Alarmtexte: python -m unittest test_regeln"""
import sqlite3
import unittest
from dataclasses import replace
from datetime import date, timedelta
from unittest.mock import patch

import alarm
from experts import extra_patterns, growth_score, index_status
from swingbot import csv_bars, evaluate, timestamp

class Regeln(unittest.TestCase):
    def setUp(self):
        self.data = csv_bars("beispiel.csv")
        self.bars = self.data["DEMO"]
        self.end = self.bars[-1].end
        self.today = self.end.date()

    def test_patterns(self):
        bars = self.bars.copy()
        flat = [replace(b,high=102,low=99,close=100) for b in bars]
        flat[-1] = replace(flat[-1],low=98,close=101)
        self.assertIn("Undercut & Rally", extra_patterns(flat))
        for i in range(-9,-5):
            flat[i] = replace(flat[i], high=107,low=101,close=103)
        for i in range(-5,-1):
            flat[i] = replace(flat[i], high=103,low=100,close=102)
        flat[-1] = replace(flat[-1], high=106,low=101,close=105,volume=5000)
        self.assertIn("Wedge Pop", extra_patterns(flat))
        for i in range(-5,-1):
            flat[i] = replace(flat[i], high=106,low=104,close=105)
        flat[-1] = replace(flat[-1], high=110,low=102,close=109)
        self.assertIn("Base’n Break", extra_patterns(flat))
        bars[-1] = replace(bars[-1],low=98,high=120,close=119)
        self.assertIn("EMA-Crossback", extra_patterns(bars))

    def test_growth_and_index(self):
        common = dict(fiscalYear=2026, reportedCurrency="USD", period="Q3",date="2026-09-30",
                      filingDate="2026-10-15", revenue=120,epsDiluted=1.25)
        prev = dict(common, fiscalYear=2025,date="2025-09-30",filingDate="2025-10-15",revenue=100,epsDiluted=1)
        self.assertIn("Wachstumskandidat",growth_score([prev,common],self.today))
        self.assertIn("verfehlt",growth_score([prev,dict(common,revenue=119)],self.today))
        csv = "observation_date,SP500\n" + '\n'.join(
            f"{self.today-timedelta(days=200-i)},{100+i}" for i in range(200))
        self.assertIn("über SMA200",index_status(csv+f"\n{self.today},1", self.today))

    def test_gap(self):
        bars = [replace(b,opening=110,prior_close=100,prior_day=date(2026,11,20),
                        high=120,close=111,low=100) for b in self.bars]
        opening_hours = [b for b in bars if b.end.hour==15]
        opening_hours[-1] = replace(opening_hours[-1],volume=3000)
        self.assertTrue(alarm.earnings_price_candidate(opening_hours))
        opening_hours[-1] = replace(opening_hours[-1],prior_close=None)
        self.assertFalse(alarm.earnings_price_candidate(opening_hours))

    def test_alert_flow(self):
        db = sqlite3.connect(":memory:")
        db.execute("CREATE TABLE sent(id TEXT PRIMARY KEY)")
        out = []
        now = timestamp("2026-11-23T20:35:00Z")
        with patch.object(alarm, "baron",return_value="Baron · Test"), patch.object(
                alarm,"growth",return_value="Giering-Modell · Test"), patch.object(
                alarm,"earnings_price_candidate",side_effect=lambda bars:bars is self.bars), patch.object(
                alarm,"recent_earnings",return_value=True):
            for _ in range(2):
                alarm.scan(db,self.end,list(("DEMO","RUHIG","TIEF")),alarm.settings(),
                           lambda:now,lambda *a,**k:(self.data,self.end),out.append)
        self.assertEqual(len(out),2)
        self.assertTrue(all("Baron · Test" in m and "Giering-Modell · Test" in m for m in out))
        self.assertIn("Episodic Pivot",out[0])
        self.assertIn("First Higher Low",out[1])
