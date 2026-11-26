import React from 'react';
import {
  Compass,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  Radar,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { formatDistanceFr, formatRelativeAgeFr, GeoPoint } from '../lib/geo';
import { NearbyParticipant } from '../hooks/useCollectiveLocations';

export type RadiusFilterOption = 1000 | 5000 | 25000 | null;

const RADIUS_OPTIONS: { value: RadiusFilterOption; label: string }[] = [
  { value: 1000, label: '1 km' },
  { value: 5000, label: '5 km' },
  { value: 25000, label: '25 km' },
  { value: null, label: 'Tous' },
];

interface NearbyParticipantsCardProps {
  nowMs: number;
  geoSupported: boolean;
  myPosition: GeoPoint | null;
  sharing: boolean;
  locating: boolean;
  geoError: string | null;
  participantsWithLocation: NearbyParticipant[];
  radiusMeters: RadiusFilterOption;
  onChangeRadius: (radius: RadiusFilterOption) => void;
  onLocateMe: () => void;
  onStartSharing: () => void;
  onStopSharing: () => void;
  onFocusOnMap?: (participant: NearbyParticipant) => void;
  isMember: boolean;
  isAuthenticated: boolean;
  isLocalOnly?: boolean;
  onJoinCollective?: () => void;
}

export const NearbyParticipantsCard: React.FC<NearbyParticipantsCardProps> = ({
  nowMs,
  geoSupported,
  myPosition,
  sharing,
  locating,
  geoError,
  participantsWithLocation,
  radiusMeters,
  onChangeRadius,
  onLocateMe,
  onStartSharing,
  onStopSharing,
  onFocusOnMap,
  isMember,
  isAuthenticated,
  isLocalOnly = false,
  onJoinCollective,
}) => {
  const otherParticipants = participantsWithLocation.filter((p) => !p.isSelf);

  const visibleParticipants = participantsWithLocation.filter((p) => {
    if (p.isSelf) return true;
    if (radiusMeters === null || p.distanceMeters === null) return true;
    return p.distanceMeters <= radiusMeters;
  });

  const nearbyCount = otherParticipants.filter((p) =>
    radiusMeters === null || p.distanceMeters === null
      ? true
      : p.distanceMeters <= radiusMeters
  ).length;

  return (
    <div className="ios-glass-subtle rounded-[22px] p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <Radar className="w-4 h-4 text-[#007AFF] dark:text-[#0A84FF] shrink-0" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Participants proches de vous
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Repérez les membres de cet événement collectif à proximité et partagez votre position en direct sur consentement.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!sharing && (
            <button
              type="button"
              onClick={onLocateMe}
              disabled={!geoSupported || locating}
              className="ios-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {locating && !sharing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LocateFixed className="w-3.5 h-3.5" />
              )}
              Me localiser
            </button>
          )}

          {sharing ? (
            <button
              type="button"
              onClick={onStopSharing}
              className="ios-btn-secondary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 whitespace-nowrap shrink-0"
            >
              <Square className="w-3 h-3 fill-current" />
              Arrêter le partage
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartSharing}
              disabled={!geoSupported || locating}
              className="ios-btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {locating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Compass className="w-3.5 h-3.5" />
              )}
              Partager ma position
            </button>
          )}
        </div>
      </div>

      {/* Membership prompt for signed-in users who haven't joined the cloud collective event yet */}
      {!isLocalOnly && isAuthenticated && !isMember && onJoinCollective && (
        <div className="rounded-[16px] border border-[#007AFF]/25 bg-[#007AFF]/[0.07] dark:bg-[#0A84FF]/15 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-slate-700 dark:text-slate-200">
            Rejoignez cet événement collectif pour accéder aux positions partagées par les membres.
          </span>
          <button
            type="button"
            onClick={onJoinCollective}
            className="font-semibold text-[#007AFF] dark:text-[#0A84FF] hover:underline whitespace-nowrap shrink-0 ios-press"
          >
            Rejoindre maintenant →
          </button>
        </div>
      )}

      {/* Privacy & Radius controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>
            {sharing
              ? 'Partage actif uniquement avec les membres de cet événement.'
              : myPosition
                ? 'Votre position reste privée (calcul de distance local uniquement).'
                : 'Aucune position transmise sans votre accord explicite.'}
          </span>
        </div>

        <div className="ios-segmented inline-flex items-center gap-1">
          {RADIUS_OPTIONS.map((opt) => {
            const active = radiusMeters === opt.value;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => onChangeRadius(opt.value)}
                className={`px-2.5 py-1 rounded-[9px] text-[11px] font-medium transition-colors whitespace-nowrap ios-press ${
                  active
                    ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {geoError && (
        <div className="rounded-[14px] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {geoError}
        </div>
      )}

      {/* List of nearby participants */}
      {visibleParticipants.length === 0 ? (
        <div className="rounded-[16px] border border-dashed border-slate-900/10 dark:border-white/15 px-4 py-5 text-center text-xs text-slate-500 dark:text-slate-400">
          {otherParticipants.length > 0 && radiusMeters !== null
            ? `Aucun participant dans un rayon de ${formatDistanceFr(radiusMeters)}. Sélectionnez « Tous » pour élargir.`
            : 'Aucun participant ne partage sa position pour le moment. Activez « Partager ma position » pour lancer la localisation du groupe.'}
        </div>
      ) : (
        <div className="space-y-2">
          {myPosition && (
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 px-1">
              {nearbyCount > 0
                ? `${nearbyCount} participant${nearbyCount > 1 ? 's' : ''} repéré${nearbyCount > 1 ? 's' : ''} dans ce périmètre`
                : 'Votre position est localisée'}
            </div>
          )}

          <div className="divide-y divide-slate-900/[0.06] dark:divide-white/[0.08] rounded-[18px] bg-white/55 dark:bg-white/[0.03] border border-slate-900/[0.06] dark:border-white/[0.08] overflow-hidden">
            {visibleParticipants.map((p) => (
              <div
                key={p.uid}
                className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0 ${
                      p.isSelf ? 'bg-[#007AFF]' : 'bg-emerald-600'
                    }`}
                  >
                    {p.displayName.trim().charAt(0).toUpperCase() || 'P'}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {p.displayName}
                      {p.isSelf ? ' (Vous)' : ''}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5">
                      {p.distanceMeters !== null && !p.isSelf && (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                          à {formatDistanceFr(p.distanceMeters)}
                        </span>
                      )}
                      {p.distanceMeters !== null && !p.isSelf && <span aria-hidden="true">·</span>}
                      <span>
                        {formatRelativeAgeFr(p.updatedAtMs ?? nowMs, nowMs)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {onFocusOnMap && (
                    <button
                      type="button"
                      onClick={() => onFocusOnMap(p)}
                      className="ios-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap"
                    >
                      <MapPin className="w-3 h-3 text-[#007AFF] dark:text-[#0A84FF]" />
                      Voir sur la carte
                    </button>
                  )}

                  {!p.isSelf && (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ios-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap"
                    >
                      <Navigation className="w-3 h-3" />
                      Rejoindre
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
