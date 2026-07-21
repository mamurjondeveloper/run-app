'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import api from '@/services/api';
import { isAxiosError } from 'axios';
import { Loader2, Square, Trash2, AlertTriangle, Volume2, VolumeX, Mountain } from 'lucide-react';
import { RouteGuide, haversineMeters } from '@/lib/routeGuidance';
import { useAuthStore } from '@/store/authStore';

const RouteMap = dynamic(() => import('@/components/RouteMap'), { ssr: false });
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const MAX_RUNNING_SPEED_KMH = 40;

interface LivePoint {
  lat: number;
  lng: number;
  ts: number;
  alt?: number;
  speedKmh?: number;
}

interface RunMeta {
  id: string;
  status: string;
  plannedRoutePath: { lat: number; lng: number }[] | null;
  plannedDistanceMeters: number | null;
}

function computeLiveStats(path: LivePoint[]) {
  let distanceMeters = 0;
  let elevationGainM = 0;
  for (let i = 1; i < path.length; i++) {
    distanceMeters += haversineMeters(path[i - 1], path[i]);
    const prevAlt = path[i - 1].alt;
    const currAlt = path[i].alt;
    if (typeof prevAlt === 'number' && typeof currAlt === 'number' && currAlt > prevAlt) {
      elevationGainM += currAlt - prevAlt;
    }
  }
  return { distanceMeters, elevationGainM };
}

function lastSegmentTooFast(path: LivePoint[]): boolean {
  if (path.length < 2) return false;
  const a = path[path.length - 2];
  const b = path[path.length - 1];
  const meters = haversineMeters(a, b);
  const sec = (b.ts - a.ts) / 1000;
  if (meters >= 200 || sec <= 0) return false;
  const kmh = meters / 1000 / (sec / 3600);
  return kmh > MAX_RUNNING_SPEED_KMH;
}

function formatPace(avgSpeedKmh: number): string {
  if (avgSpeedKmh <= 0) return '--:--';
  const minPerKm = 60 / avgSpeedKmh;
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function LiveRunPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const runId = params.id;
  const storageKey = `live-run-${runId}`;
  const avatarUrl = user?.avatarUrl ? `${API_URL}${user.avatarUrl}` : null;

  const [runMeta, setRunMeta] = useState<RunMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [livePath, setLivePath] = useState<LivePoint[]>([]);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [isFinishing, setIsFinishing] = useState(false);
  const [liveSpeedWarning, setLiveSpeedWarning] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [lastAnnouncement, setLastAnnouncement] = useState<string | null>(null);
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState(0);

  const watchIdRef = useRef<number | null>(null);
  const guideRef = useRef<RouteGuide | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/runs/${runId}`);
        if (cancelled) return;
        if (res.data.status !== 'in_progress') {
          router.replace(`/runs/${runId}`);
          return;
        }
        setRunMeta(res.data);
        const stored = typeof window !== 'undefined' ? sessionStorage.getItem(storageKey) : null;
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as { path: LivePoint[]; startedAt: number };
            setLivePath(parsed.path);
            setRunStartedAt(parsed.startedAt);
          } catch {
            setRunStartedAt(Date.now());
          }
        } else {
          setRunStartedAt(Date.now());
        }
      } catch {
        if (!cancelled) setLoadError("Bu yugurishni yuklab bo'lmadi.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    if (!runStartedAt) return;
    sessionStorage.setItem(storageKey, JSON.stringify({ path: livePath, startedAt: runStartedAt }));
  }, [livePath, runStartedAt, storageKey]);

  useEffect(() => {
    if (runMeta?.plannedRoutePath && runMeta.plannedRoutePath.length > 0 && !guideRef.current) {
      guideRef.current = new RouteGuide(runMeta.plannedRoutePath, (text) => setLastAnnouncement(text));
    }
  }, [runMeta]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => {
    if (!runMeta || watchIdRef.current != null) return;
    if (!navigator.geolocation) {
      setTrackError("Brauzeringiz jonli joylashuv kuzatuvini qo'llab-quvvatlamaydi.");
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setTrackError(null);
        const speedKmh =
          typeof position.coords.speed === 'number' && position.coords.speed >= 0
            ? Math.round(position.coords.speed * 3.6 * 10) / 10
            : undefined;
        const point: LivePoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          ts: Date.now(),
          alt: position.coords.altitude ?? undefined,
          speedKmh,
        };
        if (speedKmh !== undefined) {
          setCurrentSpeedKmh(speedKmh);
        }
        setLivePath((prev) => {
          const next = [...prev, point];
          setLiveSpeedWarning(lastSegmentTooFast(next));
          return next;
        });
        if (voiceEnabled) {
          guideRef.current?.update(point);
        }
      },
      () => setTrackError("GPS signali yo'qoldi — bu varaqni ochiq qoldiring va joylashuv ruxsatlarini tekshiring."),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runMeta, voiceEnabled]);

  const stopWatch = () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  const handleFinish = async () => {
    if (livePath.length < 2) {
      setTrackError("Bu yugurishni saqlash uchun hali yetarli GPS nuqtalari yozilmadi.");
      return;
    }
    setIsFinishing(true);
    stopWatch();
    try {
      await api.patch(`/runs/${runId}/finish`, { path: livePath });
      sessionStorage.removeItem(storageKey);
      router.push(`/runs/${runId}`);
    } catch (err) {
      setTrackError(
        isAxiosError(err) && typeof err.response?.data?.message === 'string'
          ? err.response.data.message
          : "Bu yugurishni saqlab bo'lmadi",
      );
      setIsFinishing(false);
    }
  };

  const handleDiscard = async () => {
    stopWatch();
    try {
      await api.patch(`/runs/${runId}/discard`);
    } catch {
      // best-effort — clear local state regardless
    }
    sessionStorage.removeItem(storageKey);
    router.push('/plan-run');
  };

  const toggleVoice = () => {
    setVoiceEnabled((v) => {
      if (v) window.speechSynthesis?.cancel();
      return !v;
    });
  };

  if (loadError) {
    return (
      <div className="glass-panel p-8 rounded-3xl text-center text-gray-500 max-w-lg">
        <p className="text-sm">{loadError}</p>
      </div>
    );
  }

  if (!runMeta || !runStartedAt) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const liveStats = computeLiveStats(livePath);
  const elapsedSec = Math.max(0, Math.floor((nowTick - runStartedAt) / 1000));
  const mins = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
  const secs = (elapsedSec % 60).toString().padStart(2, '0');
  const avgSpeedKmh = elapsedSec > 0 ? liveStats.distanceMeters / 1000 / (elapsedSec / 3600) : 0;

  return (
    <div className="space-y-6 pb-12 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-primary text-sm font-bold">
          <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" /> YOZILMOQDA
        </div>
        {runMeta.plannedRoutePath && runMeta.plannedRoutePath.length > 0 && (
          <button
            onClick={toggleVoice}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-white cursor-pointer"
          >
            {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            {voiceEnabled ? 'Ovoz yoniq' : "Ovoz o'chiq"}
          </button>
        )}
      </div>

      {liveSpeedWarning && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 text-amber-400 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>Juda tez — bu qism hisoblanmayapti.</span>
        </div>
      )}
      {voiceEnabled && lastAnnouncement && (
        <div className="bg-primary/10 border border-primary/20 rounded-2xl p-3 text-primary text-sm text-center font-semibold">
          🔊 {lastAnnouncement}
        </div>
      )}
      {trackError && <p className="text-red-400 text-sm">{trackError}</p>}

      <div className="glass-panel p-8 rounded-3xl text-center">
        <div className="text-5xl font-black text-white tabular-nums">
          {mins}:{secs}
        </div>
        <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">Vaqt</div>
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div>
            <div className="text-2xl font-black text-white">{(liveStats.distanceMeters / 1000).toFixed(2)}</div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">KM</div>
          </div>
          <div>
            <div className="text-2xl font-black text-white">{currentSpeedKmh.toFixed(1)}</div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">HOZIRGI KM/S</div>
          </div>
          <div>
            <div className="text-2xl font-black text-white">{formatPace(avgSpeedKmh)}</div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">DAQ/KM</div>
          </div>
        </div>
        {liveStats.elevationGainM > 0 && (
          <div className="flex items-center justify-center gap-1.5 text-gray-400 text-xs mt-5">
            <Mountain className="h-3.5 w-3.5" /> {Math.round(liveStats.elevationGainM)} m balandlik oshishi
          </div>
        )}
      </div>

      {livePath.length > 0 ? (
        <RouteMap
          path={livePath}
          secondaryPath={runMeta.plannedRoutePath ?? undefined}
          followLatest
          avatarUrl={avatarUrl}
          height={300}
        />
      ) : runMeta.plannedRoutePath ? (
        <>
          <RouteMap path={runMeta.plannedRoutePath} height={300} />
          <p className="text-xs text-gray-500 text-center">GPS signali kutilmoqda… kuzatuv boshlangach chiziqli rejalashtirilgan yo'nalishga ergashing.</p>
        </>
      ) : (
        <div className="glass-panel flex flex-col items-center justify-center gap-3 text-gray-500 text-sm" style={{ height: 300 }}>
          <Loader2 className="h-6 w-6 animate-spin" />
          GPS signali kutilmoqda…
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleDiscard}
          disabled={isFinishing}
          className="flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-red-500/30 text-red-400 font-bold text-sm cursor-pointer hover:bg-red-500/10 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" /> Bekor qilish
        </button>
        <button
          onClick={handleFinish}
          disabled={isFinishing}
          className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primary hover:bg-primary-hover text-bg-dark font-bold text-sm cursor-pointer disabled:opacity-50"
        >
          {isFinishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
          Tugatish va saqlash
        </button>
      </div>
      <p className="text-xs text-gray-500 text-center">Yugurish davomida bu varaqni ochiq qoldiring — yopish yoki ekranni qulflash kuzatuvni to'xtatadi.</p>
    </div>
  );
}
