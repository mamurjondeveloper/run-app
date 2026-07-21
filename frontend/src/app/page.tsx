'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';
import { isAxiosError } from 'axios';
import { Flame, Footprints, Gauge, Trophy, Mountain, Play, Map as MapIcon, Loader2, AlertTriangle } from 'lucide-react';

interface Stats {
  totalDistanceM: number;
  totalRuns: number;
  totalPoints: number;
  bestMaxSpeedKmh: number;
  currentStreakDays: number;
  longestStreakDays: number;
  avgSpeedKmh: number;
  totalElevationM: number;
}

interface Run {
  id: string;
  startedAt: string;
  distanceMeters: number;
  durationSec: number;
  avgSpeedKmh: number;
  pointsEarned: number;
  flaggedSegments: number;
}

function formatKm(meters: number) {
  return (meters / 1000).toFixed(2);
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, runsRes] = await Promise.all([
          api.get('/auth/stats'),
          api.get('/runs/me?limit=6'),
        ]);
        setStats(statsRes.data);
        setRuns(runsRes.data);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };
    if (user) fetchData();
  }, [user]);

  const handleStartFreeRun = async () => {
    setIsStartingRun(true);
    setStartError(null);
    try {
      const res = await api.post('/runs/start', {});
      router.push(`/run/${res.data.id}`);
    } catch (err) {
      setStartError(isAxiosError(err) && typeof err.response?.data?.message === 'string' ? err.response.data.message : "Yugurishni boshlab bo'lmadi");
      setIsStartingRun(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 bg-white/5 rounded-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white/5 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10 pb-12">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">
          Xush kelibsiz, <span className="text-primary font-bold">{user?.username}</span>
        </h1>
        <p className="text-gray-400 text-sm mt-1">Yugurishlaringiz qanday ketyapti — mana ko'ring.</p>
      </div>

      {user?.isBanned ? null : (
        <div className="glass-panel p-6 rounded-3xl flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
              <Play className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-white font-bold text-sm">Yugurishga tayyormisiz?</h3>
              <p className="text-gray-400 text-xs mt-1">
                To'g'ridan-to'g'ri shu brauzerda kuzatuvni boshlang, yoki avval yo'nalish rejalashtirib ovozli yo'l-yo'riq oling.
              </p>
              {startError && <p className="text-red-400 text-xs mt-1">{startError}</p>}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Link
              href="/plan-run"
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-white/10 text-gray-200 hover:text-white hover:border-white/20 font-bold text-sm"
            >
              <MapIcon className="h-4 w-4" /> Yugurish rejalashtirish
            </Link>
            <button
              onClick={handleStartFreeRun}
              disabled={isStartingRun}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-primary hover:bg-primary-hover text-bg-dark font-bold text-sm cursor-pointer disabled:opacity-50"
            >
              {isStartingRun ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Yugurishni boshlash
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Footprints} label="Umumiy masofa" value={`${formatKm(stats?.totalDistanceM ?? 0)} km`} />
        <StatCard icon={Trophy} label="Umumiy ballar" value={`${stats?.totalPoints ?? 0}`} />
        <StatCard icon={Gauge} label="O'rtacha tezlik" value={`${stats?.avgSpeedKmh ?? 0} km/h`} />
        <StatCard icon={Flame} label="Joriy ketma-ketlik" value={`${stats?.currentStreakDays ?? 0} kun`} />
      </div>

      {!!stats?.totalElevationM && (
        <div className="glass-panel p-4 rounded-2xl flex items-center gap-3 text-gray-300 text-sm w-fit">
          <Mountain className="h-4 w-4 text-primary" />
          <span>{Math.round(stats.totalElevationM)} m umumiy balandlik oshishi</span>
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">So'nggi yugurishlar</h2>
          <Link href="/history" className="text-primary text-sm font-semibold hover:underline">
            Barchasini ko'rish
          </Link>
        </div>
        {runs.length === 0 ? (
          <div className="glass-panel p-8 rounded-3xl text-center text-gray-500">
            <Footprints className="h-10 w-10 mx-auto text-gray-600 mb-3" />
            <p className="text-sm">Hali yugurishlar yo'q.</p>
            <Link href="/plan-run" className="text-primary text-sm font-bold mt-3 inline-block hover:underline">
              Birinchi yugurishingizni rejalashtiring
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex items-center justify-between gap-4 bg-white/5 border border-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      {new Date(run.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
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
      </section>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Footprints; label: string; value: string }) {
  return (
    <div className="glass-panel p-5 rounded-2xl">
      <Icon className="h-5 w-5 text-primary mb-3" />
      <div className="text-xl font-black text-white">{value}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </div>
  );
}
