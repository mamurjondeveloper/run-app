'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/services/api';
import { Footprints, AlertTriangle, MapPin } from 'lucide-react';

interface Run {
  id: string;
  startedAt: string;
  distanceMeters: number;
  durationSec: number;
  avgSpeedKmh: number;
  pointsEarned: number;
  flaggedSegments: number;
  plannedRoutePath?: unknown;
}

function formatKm(meters: number) {
  return (meters / 1000).toFixed(2);
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRuns = async () => {
      try {
        const res = await api.get('/runs/me?limit=200');
        setRuns(res.data);
      } catch (err) {
        console.error('Failed to load run history:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchRuns();
  }, []);

  return (
    <div className="space-y-8 pb-12 max-w-2xl">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">Yugurish tarixi</h1>
        <p className="text-gray-400 text-sm mt-1">Siz yozib olgan har bir yugurish</p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <div className="glass-panel p-12 rounded-3xl text-center text-gray-500">
          <Footprints className="h-12 w-12 mx-auto text-gray-600 mb-4" />
          <h3 className="text-lg font-semibold text-white">Hali yugurishlar yo'q</h3>
          <p className="text-sm mt-2">
            <Link href="/plan-run" className="text-primary font-semibold hover:underline">
              Yo'nalish rejalashtiring
            </Link>{' '}
            yoki bu yerda ko'rish uchun oddiy yugurishni boshlang.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="flex items-center justify-between gap-4 bg-white/5 border border-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    {new Date(run.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  {!!run.plannedRoutePath && <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />}
                  {run.flaggedSegments > 0 && <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {formatKm(run.distanceMeters)} km · {Math.round(run.durationSec / 60)} daq · {run.avgSpeedKmh} km/h
                </div>
              </div>
              <div className="text-primary font-bold text-sm shrink-0">+{run.pointsEarned} ball</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
