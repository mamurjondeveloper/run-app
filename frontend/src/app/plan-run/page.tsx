'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import { isAxiosError } from 'axios';
import { Map as MapIcon, Loader2, Navigation, LocateFixed, MapPin, Play, Square, Trash2, AlertTriangle, RefreshCw } from 'lucide-react';

const RouteMap = dynamic(() => import('@/components/RouteMap'), { ssr: false });
const LocationPicker = dynamic(() => import('@/components/LocationPicker'), { ssr: false });

const DISTANCES = [1, 2, 3, 5, 10];
const DEFAULT_CENTER = { lat: 41.2995, lng: 69.2401 };
const GEO_OPTIONS: PositionOptions = { timeout: 8000, maximumAge: 60000, enableHighAccuracy: false };
const MAX_RUNNING_SPEED_KMH = 40;

interface SuggestedRoute {
  distanceMeters: number;
  durationSec: number;
  path: { lat: number; lng: number }[];
}

interface LivePoint {
  lat: number;
  lng: number;
  ts: number;
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && typeof err.response?.data?.message === 'string') {
    return err.response.data.message;
  }
  return fallback;
}

function geoErrorMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) {
    return 'Location permission was denied. Pick your starting point on the map below instead.';
  }
  if (err.code === err.TIMEOUT) {
    return "Location lookup timed out — this is common on desktop computers. Pick your starting point on the map below instead.";
  }
  return "Couldn't determine your location automatically (common on desktop computers without Wi-Fi). Pick your starting point on the map below instead.";
}

function haversineMeters(a: LivePoint, b: LivePoint): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}

function computeLiveStats(path: LivePoint[]) {
  let distanceMeters = 0;
  for (let i = 1; i < path.length; i++) {
    distanceMeters += haversineMeters(path[i - 1], path[i]);
  }
  return { distanceMeters };
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

export default function PlanRunPage() {
  const router = useRouter();
  const [targetKm, setTargetKm] = useState(5);
  const [manualKmInput, setManualKmInput] = useState('5');
  const [point, setPoint] = useState(DEFAULT_CENTER);
  const [hasPickedPoint, setHasPickedPoint] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [route, setRoute] = useState<SuggestedRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locateNotice, setLocateNotice] = useState<string | null>(null);

  // Live run tracking state (foreground-only — works while this tab stays open,
  // same platform limitation as any browser-based GPS tracking).
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [livePath, setLivePath] = useState<LivePoint[]>([]);
  const [nowTick, setNowTick] = useState(Date.now());
  const [isStarting, setIsStarting] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [liveSpeedWarning, setLiveSpeedWarning] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const locate = () => {
    if (!navigator.geolocation) {
      setLocateNotice('Your browser does not support automatic location — pick your starting point on the map below.');
      return;
    }
    setIsLocating(true);
    setLocateNotice(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLocating(false);
        setHasPickedPoint(true);
        setPoint({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      (err) => {
        setIsLocating(false);
        setLocateNotice(geoErrorMessage(err));
      },
      GEO_OPTIONS,
    );
  };

  useEffect(() => {
    locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live elapsed-time ticker while a run is active
  useEffect(() => {
    if (!activeRunId) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeRunId]);

  // Always stop the browser's location watch on unmount so it doesn't keep running
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  // Warn before leaving the tab mid-run so an in-progress run isn't lost by accident
  useEffect(() => {
    if (!activeRunId) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activeRunId]);

  const applyManualKm = (raw: string) => {
    setManualKmInput(raw);
    const parsed = parseFloat(raw);
    if (!Number.isNaN(parsed) && parsed >= 0.5 && parsed <= 42) {
      setTargetKm(parsed);
    }
  };

  const selectChip = (km: number) => {
    setTargetKm(km);
    setManualKmInput(String(km));
  };

  const handleSuggest = async () => {
    setError(null);
    setRoute(null);
    setIsSuggesting(true);
    try {
      const res = await api.post('/routes/suggest', { lat: point.lat, lng: point.lng, targetKm });
      setRoute(res.data);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not generate a route near that point'));
    } finally {
      setIsSuggesting(false);
    }
  };

  const startWatch = () => {
    if (!navigator.geolocation) {
      setTrackError('Your browser does not support live location tracking.');
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setTrackError(null);
        setLivePath((prev) => {
          const next = [...prev, { lat: position.coords.latitude, lng: position.coords.longitude, ts: Date.now() }];
          setLiveSpeedWarning(lastSegmentTooFast(next));
          return next;
        });
      },
      () => setTrackError('Lost GPS signal — keep this tab open and check location permissions.'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  };

  const stopWatch = () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  const handleStartRunOnRoute = async () => {
    if (!route) return;
    setIsStarting(true);
    setTrackError(null);
    try {
      const res = await api.post('/runs/start', {
        plannedRoutePath: route.path,
        plannedDistanceMeters: route.distanceMeters,
      });
      setActiveRunId(res.data.id);
      setRunStartedAt(Date.now());
      setLivePath([]);
      setLiveSpeedWarning(false);
      startWatch();
    } catch (err) {
      setTrackError(getErrorMessage(err, 'Could not start the run'));
    } finally {
      setIsStarting(false);
    }
  };

  const handleFinishRun = async () => {
    if (!activeRunId) return;
    if (livePath.length < 2) {
      setTrackError('Not enough GPS points recorded yet to save this run.');
      return;
    }
    setIsFinishing(true);
    stopWatch();
    try {
      await api.patch(`/runs/${activeRunId}/finish`, { path: livePath });
      const finishedId = activeRunId;
      setActiveRunId(null);
      setRunStartedAt(null);
      setLivePath([]);
      router.push(`/runs/${finishedId}`);
    } catch (err) {
      setTrackError(getErrorMessage(err, 'Could not save this run'));
      setIsFinishing(false);
    }
  };

  const handleDiscardRun = async () => {
    if (!activeRunId) return;
    stopWatch();
    try {
      await api.patch(`/runs/${activeRunId}/discard`);
    } catch {
      // best-effort — clear local state regardless
    }
    setActiveRunId(null);
    setRunStartedAt(null);
    setLivePath([]);
    setTrackError(null);
  };

  if (activeRunId) {
    const liveStats = computeLiveStats(livePath);
    const elapsedSec = runStartedAt ? Math.max(0, Math.floor((nowTick - runStartedAt) / 1000)) : 0;
    const mins = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
    const secs = (elapsedSec % 60).toString().padStart(2, '0');
    const avgSpeedKmh = elapsedSec > 0 ? (liveStats.distanceMeters / 1000 / (elapsedSec / 3600)).toFixed(1) : '0.0';

    return (
      <div className="space-y-6 pb-12 max-w-2xl">
        <div className="flex items-center gap-2 text-primary text-sm font-bold">
          <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" /> RECORDING
        </div>

        {liveSpeedWarning && (
          <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 text-amber-400 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>Too fast for running — this part isn&apos;t being counted.</span>
          </div>
        )}
        {trackError && <p className="text-red-400 text-sm">{trackError}</p>}

        <div className="glass-panel p-8 rounded-3xl text-center">
          <div className="text-5xl font-black text-white tabular-nums">{mins}:{secs}</div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">Time</div>
          <div className="grid grid-cols-2 gap-4 mt-6">
            <div>
              <div className="text-2xl font-black text-white">{(liveStats.distanceMeters / 1000).toFixed(2)}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">KM</div>
            </div>
            <div>
              <div className="text-2xl font-black text-white">{avgSpeedKmh}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">AVG KM/H</div>
            </div>
          </div>
        </div>

        <RouteMap
          path={livePath.length > 1 ? livePath : route?.path ?? []}
          secondaryPath={route?.path}
          height={300}
        />
        {livePath.length < 2 && <p className="text-xs text-gray-500 text-center">Waiting for a GPS fix… follow the dashed planned route once tracking starts.</p>}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleDiscardRun}
            disabled={isFinishing}
            className="flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-red-500/30 text-red-400 font-bold text-sm cursor-pointer hover:bg-red-500/10 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> Discard
          </button>
          <button
            onClick={handleFinishRun}
            disabled={isFinishing}
            className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primary hover:bg-primary-hover text-bg-dark font-bold text-sm cursor-pointer disabled:opacity-50"
          >
            {isFinishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            Finish & Save
          </button>
        </div>
        <p className="text-xs text-gray-500 text-center">Keep this tab open while running — closing it or locking your screen stops tracking.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12 max-w-2xl">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl flex items-center gap-3">
          <MapIcon className="h-8 w-8 text-primary" /> Plan a Run
        </h1>
        <p className="text-gray-400 text-sm mt-1">Pick a distance and get a loop route to follow.</p>
      </div>

      <div className="glass-panel p-6 rounded-3xl space-y-5">
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Target Distance</div>
          <div className="flex flex-wrap items-center gap-2">
            {DISTANCES.map((km) => (
              <button
                key={km}
                onClick={() => selectChip(km)}
                className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                  targetKm === km ? 'bg-primary text-black' : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'
                }`}
              >
                {km} km
              </button>
            ))}
            <div className="flex items-center gap-1.5 ml-1">
              <input
                type="number"
                min={0.5}
                max={42}
                step={0.1}
                value={manualKmInput}
                onChange={(e) => applyManualKm(e.target.value)}
                className="w-20 px-3 py-2.5 rounded-xl text-sm font-bold bg-white/5 border border-white/10 text-white focus:outline-none focus:border-primary"
              />
              <span className="text-xs text-gray-500">km (custom)</span>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Starting Point
            </div>
            <button
              onClick={locate}
              disabled={isLocating}
              className="text-xs font-semibold text-primary hover:text-primary-hover flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isLocating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
              Use my location
            </button>
          </div>
          <LocationPicker
            value={point}
            onChange={(p) => {
              setHasPickedPoint(true);
              setPoint(p);
            }}
            height={220}
          />
          <p className="text-xs text-gray-500 mt-2">
            {hasPickedPoint ? 'Tap the map to move your starting point.' : 'Tap the map to set your starting point.'}
          </p>
          {locateNotice && <p className="text-amber-400 text-xs mt-2">{locateNotice}</p>}
        </div>

        <button
          onClick={handleSuggest}
          disabled={isSuggesting}
          className="w-full bg-primary hover:bg-primary-hover text-bg-dark font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-50 text-sm"
        >
          {isSuggesting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Finding a route…
            </>
          ) : (
            <>
              <Navigation className="h-5 w-5" />
              {route ? 'Suggest another route' : `Suggest a ${targetKm} km route`}
            </>
          )}
        </button>

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      </div>

      {route && (
        <div className="space-y-4">
          <RouteMap path={route.path} height={360} />
          <div className="grid grid-cols-2 gap-4">
            <div className="glass-panel p-5 rounded-2xl text-center">
              <div className="text-xl font-black text-white">{(route.distanceMeters / 1000).toFixed(2)} km</div>
              <div className="text-xs text-gray-400 mt-1">Route Distance</div>
            </div>
            <div className="glass-panel p-5 rounded-2xl text-center">
              <div className="text-xl font-black text-white">~{Math.round(route.durationSec / 60)} min</div>
              <div className="text-xs text-gray-400 mt-1">Estimated Walk Time</div>
            </div>
          </div>

          {trackError && <p className="text-red-400 text-sm text-center">{trackError}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={handleSuggest}
              disabled={isSuggesting}
              className="flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-white/10 text-gray-300 hover:text-white hover:border-white/20 font-bold text-sm cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" /> Try another route
            </button>
            <button
              onClick={handleStartRunOnRoute}
              disabled={isStarting}
              className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primary hover:bg-primary-hover text-bg-dark font-bold text-sm cursor-pointer disabled:opacity-50"
            >
              {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Start Running This Route
            </button>
          </div>
          <p className="text-xs text-gray-500 text-center">
            Tracking works right here in the browser while this tab stays open — or open the RunApp mobile app to track in the background instead.
          </p>
        </div>
      )}
    </div>
  );
}
