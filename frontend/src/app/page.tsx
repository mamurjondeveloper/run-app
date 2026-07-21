'use client';

import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';
import { Flame, Footprints, Gauge, Trophy, Smartphone } from 'lucide-react';

interface Stats {
  totalDistanceM: number;
  totalRuns: number;
  totalPoints: number;
  bestMaxSpeedKmh: number;
  currentStreakDays: number;
  longestStreakDays: number;
  avgSpeedKmh: number;
}

interface Run {
  id: string;
  startedAt: string;
  distanceMeters: number;
  durationSec: number;
  avgSpeedKmh: number;
  pointsEarned: number;
}

function formatKm(meters: number) {
  return (meters / 1000).toFixed(2);
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<Stats | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

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
          Welcome back, <span className="text-primary font-bold">{user?.username}</span>
        </h1>
        <p className="text-gray-400 text-sm mt-1">Here&apos;s how your running is going.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Footprints} label="Total Distance" value={`${formatKm(stats?.totalDistanceM ?? 0)} km`} />
        <StatCard icon={Trophy} label="Total Points" value={`${stats?.totalPoints ?? 0}`} />
        <StatCard icon={Gauge} label="Avg Speed" value={`${stats?.avgSpeedKmh ?? 0} km/h`} />
        <StatCard icon={Flame} label="Current Streak" value={`${stats?.currentStreakDays ?? 0} days`} />
      </div>

      <div className="glass-panel p-6 rounded-3xl flex items-center gap-4">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0">
          <Smartphone className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h3 className="text-white font-bold text-sm">Start a run from the mobile app</h3>
          <p className="text-gray-400 text-xs mt-1">
            GPS run tracking needs to keep working while your screen is locked, so recording happens in the RunApp mobile app, not the browser. This dashboard is for stats and leaderboards.
          </p>
        </div>
      </div>

      <section>
        <h2 className="text-xl font-bold text-white mb-4">Recent Runs</h2>
        {runs.length === 0 ? (
          <div className="glass-panel p-8 rounded-3xl text-center text-gray-500">
            <Footprints className="h-10 w-10 mx-auto text-gray-600 mb-3" />
            <p className="text-sm">No runs yet. Record one from the mobile app to see it here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between gap-4 bg-white/5 border border-white/5 rounded-2xl p-4 hover:bg-white/10 transition-all"
              >
                <div>
                  <div className="text-sm font-semibold text-white">
                    {new Date(run.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {formatKm(run.distanceMeters)} km · {Math.round(run.durationSec / 60)} min · {run.avgSpeedKmh} km/h
                  </div>
                </div>
                <div className="text-primary font-bold text-sm shrink-0">+{run.pointsEarned} pts</div>
              </div>
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
