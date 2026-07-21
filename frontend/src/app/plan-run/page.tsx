'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import api from '@/services/api';
import { isAxiosError } from 'axios';
import { Map as MapIcon, Loader2, Navigation } from 'lucide-react';

const RouteMap = dynamic(() => import('@/components/RouteMap'), { ssr: false });

const DISTANCES = [1, 2, 3, 5, 10];

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

export default function PlanRunPage() {
  const [targetKm, setTargetKm] = useState(5);
  const [isLocating, setIsLocating] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [route, setRoute] = useState<SuggestedRoute | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSuggest = () => {
    setError(null);
    setRoute(null);

    if (!navigator.geolocation) {
      setError('Your browser does not support location access.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setIsLocating(false);
        setIsSuggesting(true);
        try {
          const res = await api.post('/routes/suggest', {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            targetKm,
          });
          setRoute(res.data);
        } catch (err) {
          setError(getErrorMessage(err, 'Could not generate a route near you'));
        } finally {
          setIsSuggesting(false);
        }
      },
      () => {
        setIsLocating(false);
        setError('Location access was denied. Please allow location access and try again.');
      },
    );
  };

  return (
    <div className="space-y-8 pb-12 max-w-2xl">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white md:text-4xl flex items-center gap-3">
          <MapIcon className="h-8 w-8 text-primary" /> Plan a Run
        </h1>
        <p className="text-gray-400 text-sm mt-1">Pick a distance and get a loop route near you to follow.</p>
      </div>

      <div className="glass-panel p-6 rounded-3xl space-y-5">
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Target Distance</div>
          <div className="flex flex-wrap gap-2">
            {DISTANCES.map((km) => (
              <button
                key={km}
                onClick={() => setTargetKm(km)}
                className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                  targetKm === km ? 'bg-primary text-black' : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'
                }`}
              >
                {km} km
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleSuggest}
          disabled={isLocating || isSuggesting}
          className="w-full bg-primary hover:bg-primary-hover text-bg-dark font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-50 text-sm"
        >
          {isLocating || isSuggesting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {isLocating ? 'Getting your location…' : 'Finding a route…'}
            </>
          ) : (
            <>
              <Navigation className="h-5 w-5" />
              Suggest a {targetKm} km route near me
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
          <p className="text-xs text-gray-500 text-center">
            Open the RunApp mobile app and hit Start Run, then follow this loop to hit your target distance.
          </p>
        </div>
      )}
    </div>
  );
}
