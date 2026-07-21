'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import { isAxiosError } from 'axios';
import { Map as MapIcon, Loader2, Navigation, LocateFixed, MapPin, Play, RefreshCw } from 'lucide-react';

const RouteMap = dynamic(() => import('@/components/RouteMap'), { ssr: false });
const LocationPicker = dynamic(() => import('@/components/LocationPicker'), { ssr: false });

const DISTANCES = [1, 2, 3, 5, 10];
const DEFAULT_CENTER = { lat: 41.2995, lng: 69.2401 };
const GEO_OPTIONS: PositionOptions = { timeout: 8000, maximumAge: 60000, enableHighAccuracy: false };

interface SuggestedRoute {
  distanceMeters: number;
  durationSec: number;
  path: { lat: number; lng: number }[];
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && typeof err.response?.data?.message === 'string') {
    return err.response.data.message;
  }
  return fallback;
}

function geoErrorMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) {
    return "Joylashuvga ruxsat berilmadi. Buning o'rniga quyidagi xaritadan boshlanish nuqtangizni tanlang.";
  }
  if (err.code === err.TIMEOUT) {
    return "Joylashuvni aniqlash vaqti tugadi — bu kompyuterlarda ko'p uchraydi. Quyidagi xaritadan boshlanish nuqtangizni tanlang.";
  }
  return "Joylashuvingizni avtomatik aniqlab bo'lmadi (Wi-Fi'siz kompyuterlarda ko'p uchraydi). Quyidagi xaritadan boshlanish nuqtangizni tanlang.";
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
  const [isStarting, setIsStarting] = useState(false);

  const locate = () => {
    if (!navigator.geolocation) {
      setLocateNotice("Brauzeringiz avtomatik joylashuvni qo'llab-quvvatlamaydi — quyidagi xaritadan boshlanish nuqtangizni tanlang.");
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
      setError(getErrorMessage(err, "Bu nuqta yaqinida yo'nalish yaratib bo'lmadi"));
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleStartRunOnRoute = async () => {
    if (!route) return;
    setIsStarting(true);
    setError(null);
    try {
      const res = await api.post('/runs/start', {
        plannedRoutePath: route.path,
        plannedDistanceMeters: route.distanceMeters,
      });
      router.push(`/run/${res.data.id}`);
    } catch (err) {
      setError(getErrorMessage(err, "Yugurishni boshlab bo'lmadi"));
      setIsStarting(false);
    }
  };

  return (
    <div className="space-y-8 pb-12 max-w-2xl">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl flex items-center gap-3">
          <MapIcon className="h-8 w-8 text-primary" /> Yugurish rejalashtirish
        </h1>
        <p className="text-gray-400 text-sm mt-1">Masofani tanlang va davom etadigan aylanma yo'nalish oling.</p>
      </div>

      <div className="glass-panel p-6 rounded-3xl space-y-5">
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Maqsad masofa</div>
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
              <span className="text-xs text-gray-500">km (qo'lda)</span>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Boshlanish nuqtasi
            </div>
            <button
              onClick={locate}
              disabled={isLocating}
              className="text-xs font-semibold text-primary hover:text-primary-hover flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isLocating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
              Joylashuvimni ishlatish
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
            {hasPickedPoint ? 'Boshlanish nuqtangizni ko\'chirish uchun xaritaga bosing.' : 'Boshlanish nuqtangizni belgilash uchun xaritaga bosing.'}
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
              Yo'nalish qidirilmoqda…
            </>
          ) : (
            <>
              <Navigation className="h-5 w-5" />
              {route ? "Boshqa yo'nalish taklif qilish" : `${targetKm} km yo'nalish taklif qilish`}
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
              <div className="text-xs text-gray-400 mt-1">Yo'nalish masofasi</div>
            </div>
            <div className="glass-panel p-5 rounded-2xl text-center">
              <div className="text-xl font-black text-white">~{Math.round(route.durationSec / 60)} daq</div>
              <div className="text-xs text-gray-400 mt-1">Taxminiy yurish vaqti</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={handleSuggest}
              disabled={isSuggesting}
              className="flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-white/10 text-gray-300 hover:text-white hover:border-white/20 font-bold text-sm cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" /> Boshqa yo'nalish sinash
            </button>
            <button
              onClick={handleStartRunOnRoute}
              disabled={isStarting}
              className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primary hover:bg-primary-hover text-bg-dark font-bold text-sm cursor-pointer disabled:opacity-50"
            >
              {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Shu yo'nalish bo'ylab yugurishni boshlash
            </button>
          </div>
          <p className="text-xs text-gray-500 text-center">
            Ovozli yo'l-yo'riq va jonli kuzatuv keyingi ekranda boshlanadi — yugurish davomida brauzer varag'ini ochiq qoldiring.
          </p>
        </div>
      )}
    </div>
  );
}
