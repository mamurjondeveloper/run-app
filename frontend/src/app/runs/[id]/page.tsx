'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import api from '@/services/api';
import { ArrowLeft, Footprints, Gauge, Clock, Zap, AlertTriangle, Mountain, TrendingUp } from 'lucide-react';
import RunChart from '@/components/RunChart';
import { haversineMeters } from '@/lib/routeGuidance';

const RouteMap = dynamic(() => import('@/components/RouteMap'), { ssr: false });

interface RunPathPoint {
  lat: number;
  lng: number;
  ts: number;
  alt?: number;
}

interface RunDetail {
  id: string;
  startedAt: string;
  distanceMeters: number;
  durationSec: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  pointsEarned: number;
  flaggedSegments: number;
  path: RunPathPoint[];
  plannedRoutePath: { lat: number; lng: number }[] | null;
  plannedDistanceMeters: number | null;
  elevationGainM: number;
}

const MAX_RUNNING_SPEED_KMH = 40;

function buildChartSeries(path: RunPathPoint[]) {
  const speedSeries: { x: number; y: number }[] = [];
  const elevationSeries: { x: number; y: number }[] = [];
  let cumulativeKm = 0;
  let hasElevation = false;

  const sorted = [...path].sort((a, b) => a.ts - b.ts);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const segMeters = haversineMeters(prev, curr);
    const segSec = (curr.ts - prev.ts) / 1000;
    if (segMeters >= 200) continue; // GPS noise gap — same threshold the backend uses

    cumulativeKm += segMeters / 1000;
    const speedKmh = segSec > 0 ? segMeters / 1000 / (segSec / 3600) : 0;
    speedSeries.push({ x: cumulativeKm, y: Math.min(speedKmh, MAX_RUNNING_SPEED_KMH) });

    if (typeof curr.alt === 'number') {
      hasElevation = true;
      elevationSeries.push({ x: cumulativeKm, y: curr.alt });
    }
  }

  return { speedSeries, elevationSeries: hasElevation ? elevationSeries : [] };
}

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRun = async () => {
      try {
        const res = await api.get(`/runs/${params.id}`);
        setRun(res.data);
      } catch {
        setError("Bu yugurishni yuklab bo'lmadi");
      } finally {
        setLoading(false);
      }
    };
    fetchRun();
  }, [params.id]);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse max-w-2xl">
        <div className="h-8 w-48 bg-white/5 rounded-2xl" />
        <div className="h-80 bg-white/5 rounded-3xl" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="glass-panel p-8 rounded-3xl text-center text-gray-500 max-w-lg">
        <p className="text-sm">{error || 'Yugurish topilmadi'}</p>
        <button onClick={() => router.push('/')} className="text-primary text-sm font-bold mt-4 hover:underline cursor-pointer">
          Boshqaruv paneliga qaytish
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 max-w-2xl">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-gray-400 hover:text-white text-sm font-semibold cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" /> Orqaga
      </button>

      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-white">
          {new Date(run.startedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          {new Date(run.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      {run.flaggedSegments > 0 && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 text-amber-400 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>
            Bu yugurishning {run.flaggedSegments} qismi yugurish tezligidan tez bo&apos;lgani uchun hisoblanmadi.
          </span>
        </div>
      )}

      {run.path.length > 1 ? (
        <div className="space-y-2">
          <RouteMap path={run.path} secondaryPath={run.plannedRoutePath ?? undefined} />
          {run.plannedRoutePath && run.plannedRoutePath.length > 0 && (
            <div className="flex items-center gap-4 text-xs text-gray-400 px-1">
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-primary rounded-full" /> Haqiqiy</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-zinc-500 rounded-full" style={{ backgroundImage: 'repeating-linear-gradient(90deg, #71717a 0 4px, transparent 4px 7px)' }} /> Rejalashtirilgan yo'nalish</span>
              {run.plannedDistanceMeters != null && (
                <span className="ml-auto">Reja {(run.plannedDistanceMeters / 1000).toFixed(2)} km</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="glass-panel p-8 rounded-3xl text-center text-gray-500 text-sm">Bu yugurish uchun yo'nalish ma'lumoti yo'q</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={Footprints} label="Masofa" value={`${(run.distanceMeters / 1000).toFixed(2)} km`} />
        <Stat icon={Clock} label="Davomiyligi" value={`${Math.floor(run.durationSec / 60)}:${(run.durationSec % 60).toString().padStart(2, '0')}`} />
        <Stat icon={Gauge} label="O'rtacha tezlik" value={`${run.avgSpeedKmh} km/h`} />
        <Stat icon={Zap} label="Maksimal tezlik" value={`${run.maxSpeedKmh} km/h`} />
        {run.elevationGainM > 0 && <Stat icon={Mountain} label="Balandlik oshishi" value={`${Math.round(run.elevationGainM)} m`} />}
      </div>

      {(() => {
        if (run.path.length < 3) return null;
        const { speedSeries, elevationSeries } = buildChartSeries(run.path);
        return (
          <>
            {speedSeries.length > 1 && (
              <div className="glass-panel p-6 rounded-3xl">
                <div className="flex items-center gap-2 text-sm font-bold text-white mb-4">
                  <TrendingUp className="h-4 w-4 text-primary" /> Masofa bo'yicha tezlik
                </div>
                <RunChart
                  points={speedSeries}
                  color="#22c55e"
                  yFormatter={(v) => `${v.toFixed(0)}`}
                  xFormatter={(v) => `${v.toFixed(1)} km`}
                />
              </div>
            )}
            {elevationSeries.length > 1 && (
              <div className="glass-panel p-6 rounded-3xl">
                <div className="flex items-center gap-2 text-sm font-bold text-white mb-4">
                  <Mountain className="h-4 w-4 text-primary" /> Balandlik profili
                </div>
                <RunChart
                  points={elevationSeries}
                  color="#a78bfa"
                  yFormatter={(v) => `${v.toFixed(0)}m`}
                  xFormatter={(v) => `${v.toFixed(1)} km`}
                />
              </div>
            )}
          </>
        );
      })()}

      <div className="glass-panel p-6 rounded-3xl text-center">
        <div className="text-3xl font-black text-primary">+{run.pointsEarned}</div>
        <div className="text-xs text-gray-400 mt-1 uppercase tracking-wider font-semibold">To'plangan ballar</div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Footprints; label: string; value: string }) {
  return (
    <div className="glass-panel p-5 rounded-2xl">
      <Icon className="h-5 w-5 text-primary mb-3" />
      <div className="text-xl font-black text-white">{value}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </div>
  );
}
