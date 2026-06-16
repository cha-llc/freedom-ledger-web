'use client';

import React, { useMemo, useState } from 'react';
import { useStore } from '@/core/useStore';
import { formatMoney } from '@/core/format';
import { calcTravel } from '@/core/finance';
import { cjBotService } from '@/core/cjBotService';
import type { CJBotResponse } from '@/core/cjBotTypes';
import { Card, SectionLabel, CJBotInsightCard, CJDisclaimer, EmptyState, Field } from '@/components/ui';
import { Plane } from 'lucide-react';

export default function TravelPage() {
  const store = useStore();
  const cur = store.settings.currency;
  const fmt = (n: number) => formatMoney(n, cur);
  const ctx = useMemo(() => store.buildFinanceContext(), [store]);

  const [destination, setDestination] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [flightCost, setFlight] = useState('');
  const [lodgingCost, setLodging] = useState('');
  const [foodBudget, setFood] = useState('');
  const [transportationCost, setTransport] = useState('');
  const [emergencyBuffer, setBuffer] = useState('');
  const [insight, setInsight] = useState<CJBotResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const latest = store.travelPlans[0];
  const result = latest ? calcTravel(latest) : null;

  async function analyze() {
    const plan = store.addTravelPlan({
      destination: destination || 'Trip',
      departureDate: departureDate || new Date().toISOString().slice(0, 10),
      returnDate: returnDate || new Date().toISOString().slice(0, 10),
      flightCost: parseFloat(flightCost) || 0,
      baggageCost: 0,
      lodgingCost: parseFloat(lodgingCost) || 0,
      transportationCost: parseFloat(transportationCost) || 0,
      foodBudget: parseFloat(foodBudget) || 0,
      documentCost: 0,
      emergencyBuffer: parseFloat(emergencyBuffer) || 0,
      currentAvailableCash: store.cashAvailable,
      expectedIncomeBeforeTrip: 0,
    });
    setLoading(true);
    const r = await cjBotService.analyzeTravelPlan(plan, ctx);
    setInsight(r);
    setLoading(false);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Travel</div>
          <div className="page-subtitle">Find out if a trip is safe, risky, or not affordable yet</div>
        </div>
      </div>

      <Card>
        <div className="grid grid-2">
          <Field label="Destination"><input className="input" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Bogotá" /></Field>
          <Field label="Departure date"><input className="input" type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} /></Field>
          <Field label="Flights"><input className="input" type="number" value={flightCost} onChange={(e) => setFlight(e.target.value)} /></Field>
          <Field label="Lodging"><input className="input" type="number" value={lodgingCost} onChange={(e) => setLodging(e.target.value)} /></Field>
          <Field label="Food budget"><input className="input" type="number" value={foodBudget} onChange={(e) => setFood(e.target.value)} /></Field>
          <Field label="Local transport"><input className="input" type="number" value={transportationCost} onChange={(e) => setTransport(e.target.value)} /></Field>
          <Field label="Emergency buffer"><input className="input" type="number" value={emergencyBuffer} onChange={(e) => setBuffer(e.target.value)} /></Field>
        </div>
        <button className="btn btn-primary" onClick={analyze}>
          <Plane size={16} /> Ask CJ-Bot if I can afford it
        </button>
      </Card>

      {result && (
        <>
          <SectionLabel>Verdict</SectionLabel>
          <div className="hero" style={{ marginBottom: 16 }}>
            <div className="hero-label">{latest.destination.toUpperCase()}</div>
            <div
              className="hero-amount"
              style={{
                fontSize: 34,
                color:
                  result.status === 'safe'
                    ? 'var(--success)'
                    : result.status === 'risky'
                    ? 'var(--warning)'
                    : 'var(--danger)',
              }}
            >
              {result.status === 'safe' ? 'Safe to take' : result.status === 'risky' ? 'Risky' : 'Not yet'}
            </div>
            <div className="hero-sub">
              Total {fmt(result.totalTripCost)} · {fmt(result.cashAfterTrip)} left after
              {result.stillNeeded > 0 ? ` · short ${fmt(result.stillNeeded)}` : ''}
            </div>
          </div>
          <CJBotInsightCard response={insight} loading={loading} role="Travel Decision" />
          <CJDisclaimer />
        </>
      )}

      {!result && (
        <Card style={{ marginTop: 16 }}>
          <EmptyState title="No trip analyzed yet" hint="Enter trip costs above and let CJ-Bot run the numbers." />
        </Card>
      )}
    </>
  );
}
