'use client';

import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import { Trophy, Medal } from 'lucide-react';

type Period = 'daily' | 'weekly' | 'alltime';

interface Entry {
  rank: number;
  userId: string;
  username: string;
  avatarUrl: string | null;
  distanceMeters: number;
  points: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const TABS: { key: Period; label: string }[] = [
  { key: 'daily', label: 'Kunlik' },
  { key: 'weekly', label: 'Haftalik' },
  { key: 'alltime', label: 'Barcha vaqt' },
];

interface MyRank {
  rank: number | null;
  entry: Entry | null;
}

export default function LeaderboardPage() {
  const { user } = useAuthStore();
  const [period, setPeriod] = useState<Period>('daily');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [myRank, setMyRank] = useState<MyRank | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBoard = async () => {
      setLoading(true);
      try {
        const [boardRes, meRes] = await Promise.all([
          api.get(`/leaderboard?period=${period}`),
          api.get(`/leaderboard/me?period=${period}`),
        ]);
        setEntries(boardRes.data);
        setMyRank(meRes.data);
      } catch (err) {
        console.error('Failed to load leaderboard:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchBoard();
  }, [period]);

  const amIVisible = entries.some((e) => e.userId === user?.id);

  return (
    <div className="space-y-8 pb-12 max-w-2xl">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl flex items-center gap-3">
          <Trophy className="h-8 w-8 text-primary" /> Reyting
        </h1>
        <p className="text-gray-400 text-sm mt-1">Eng ko'p yugurganlarni ko'ring.</p>
      </div>

      <div className="flex gap-2 bg-white/5 border border-white/10 rounded-2xl p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setPeriod(tab.key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
              period === tab.key ? 'bg-primary text-black' : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!loading && !amIVisible && myRank?.rank && myRank.entry && (
        <div className="flex items-center gap-4 p-4 rounded-2xl border border-primary/30 bg-primary/10">
          <div className="w-8 text-center shrink-0">
            <span className="text-sm font-bold text-primary">{myRank.rank}</span>
          </div>
          <div className="h-10 w-10 rounded-full bg-primary/20 border border-primary/20 flex items-center justify-center shrink-0 text-xs font-bold text-primary overflow-hidden">
            {myRank.entry.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${API_URL}${myRank.entry.avatarUrl}`} alt={myRank.entry.username} className="h-full w-full object-cover" />
            ) : (
              myRank.entry.username.slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white truncate">
              {myRank.entry.username} <span className="text-primary text-xs">(siz)</span>
            </div>
            <div className="text-xs text-gray-400">{(myRank.entry.distanceMeters / 1000).toFixed(2)} km</div>
          </div>
          <div className="text-primary font-bold text-sm shrink-0">{myRank.entry.points} ball</div>
        </div>
      )}

      {!loading && !myRank?.rank && (
        <div className="text-xs text-gray-500 italic">Siz bu davrda hali yugurmagansiz — reytingda ko'rinish uchun yugurishni yozib oling.</div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="glass-panel p-8 rounded-3xl text-center text-gray-500">
          <Trophy className="h-10 w-10 mx-auto text-gray-600 mb-3" />
          <p className="text-sm">Bu davrda hali yugurishlar qayd etilmagan.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const isMe = entry.userId === user?.id;
            return (
              <div
                key={entry.userId}
                className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                  isMe ? 'bg-primary/10 border-primary/30' : 'bg-white/5 border-white/5'
                }`}
              >
                <div className="w-8 text-center shrink-0">
                  {entry.rank <= 3 ? (
                    <Medal className={`h-5 w-5 mx-auto ${
                      entry.rank === 1 ? 'text-yellow-400' : entry.rank === 2 ? 'text-gray-300' : 'text-amber-700'
                    }`} />
                  ) : (
                    <span className="text-sm font-bold text-gray-500">{entry.rank}</span>
                  )}
                </div>
                <div className="h-10 w-10 rounded-full bg-primary/20 border border-primary/20 flex items-center justify-center shrink-0 text-xs font-bold text-primary overflow-hidden">
                  {entry.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`${API_URL}${entry.avatarUrl}`} alt={entry.username} className="h-full w-full object-cover" />
                  ) : (
                    entry.username.slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">
                    {entry.username} {isMe && <span className="text-primary text-xs">(siz)</span>}
                  </div>
                  <div className="text-xs text-gray-400">{(entry.distanceMeters / 1000).toFixed(2)} km</div>
                </div>
                <div className="text-primary font-bold text-sm shrink-0">{entry.points} ball</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
