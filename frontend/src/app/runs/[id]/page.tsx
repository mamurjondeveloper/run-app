'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import api from '@/services/api';
import { ArrowLeft, Footprints, Gauge, Clock, Zap, AlertTriangle } from 'lucide-react';

const RouteMap = dynamic(() => import('@/components/RouteMap'), { ssr: false });

interface RunDetail {
  id: string;
  startedAt: string;
  distanceMeters: number;
  durationSec: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  pointsEarned: number;
  flaggedSegments: number;
  path: { lat: number; lng: number }[];
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
        setError('Could not load this run');
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
        <p className="text-sm">{error || 'Run not found'}</p>
        <button onClick={() => router.push('/')} className="text-primary text-sm font-bold mt-4 hover:underline cursor-pointer">
          Back to dashboard
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
        <ArrowLeft className="h-4 w-4" /> Back
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
            {run.flaggedSegments} part{run.flaggedSegments > 1 ? 's' : ''} of this run were faster than running speed and weren&apos;t counted.
          </span>
        </div>
      )}

      {run.path.length > 1 ? (
        <RouteMap path={run.path} />
      ) : (
        <div className="glass-panel p-8 rounded-3xl text-center text-gray-500 text-sm">No route data for this run</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={Footprints} label="Distance" value={`${(run.distanceMeters / 1000).toFixed(2)} km`} />
        <Stat icon={Clock} label="Duration" value={`${Math.floor(run.durationSec / 60)}:${(run.durationSec % 60).toString().padStart(2, '0')}`} />
        <Stat icon={Gauge} label="Avg Speed" value={`${run.avgSpeedKmh} km/h`} />
        <Stat icon={Zap} label="Max Speed" value={`${run.maxSpeedKmh} km/h`} />
      </div>

      <div className="glass-panel p-6 rounded-3xl text-center">
        <div className="text-3xl font-black text-primary">+{run.pointsEarned}</div>
        <div className="text-xs text-gray-400 mt-1 uppercase tracking-wider font-semibold">Points Earned</div>
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
