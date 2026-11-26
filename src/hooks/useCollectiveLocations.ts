import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { CountdownEvent, FIELD_LIMITS, ParticipantLocation } from '../types';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { GeoPoint, haversineDistanceMeters } from '../lib/geo';
import { PeerLocation } from './useRealtimeRoom';

const STALE_LOCATION_MS = 2 * 60 * 60 * 1000; // 2 hours
const FIRESTORE_THROTTLE_MS = 12_000;
const FIRESTORE_MIN_MOVE_METERS = 25;

export interface NearbyParticipant extends ParticipantLocation {
  isSelf: boolean;
  distanceMeters: number | null;
  source: 'live' | 'cloud';
}

interface UseCollectiveLocationsOptions {
  event: CountdownEvent;
  currentUserId: string;
  currentUserName: string;
  isAuthenticated: boolean;
  isMember: boolean;
  peerLocations: PeerLocation[];
  wsConnected: boolean;
  sendLocationUpdate: (lat: number, lng: number, accuracy?: number) => void;
  sendLocationStop: () => void;
  onEnsureMember?: () => Promise<void>;
}

function parseTimestampMs(val: unknown): number {
  if (val && typeof val === 'object' && 'toMillis' in val) {
    const fn = (val as { toMillis?: unknown }).toMillis;
    if (typeof fn === 'function') {
      return (val as { toMillis: () => number }).toMillis();
    }
  }
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  return Date.now();
}

function getGeolocationErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "L'accès à votre position a été refusé par le navigateur.";
    case err.POSITION_UNAVAILABLE:
      return 'Position GPS actuellement indisponible sur cet appareil.';
    case err.TIMEOUT:
      return 'Délai dépassé lors de la détection de votre position.';
    default:
      return 'Impossible de récupérer votre position actuelle.';
  }
}

export function useCollectiveLocations({
  event,
  currentUserId,
  currentUserName,
  isAuthenticated,
  isMember,
  peerLocations,
  wsConnected,
  sendLocationUpdate,
  sendLocationStop,
  onEnsureMember,
}: UseCollectiveLocationsOptions) {
  const geoSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  const [myPosition, setMyPosition] = useState<GeoPoint | null>(null);
  const [sharing, setSharing] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [cloudLocations, setCloudLocations] = useState<ParticipantLocation[]>([]);

  const watchIdRef = useRef<number | null>(null);
  const lastCloudSyncRef = useRef<{ time: number; lat: number; lng: number } | null>(null);
  const sharingEventIdRef = useRef<string | null>(null);

  const canUseCloudLocations =
    event.scope === 'collective' &&
    !event.isLocalOnly &&
    isAuthenticated &&
    isMember &&
    event.status === 'active';

  // Listen to Firestore /countdowns/{id}/locations when member of an active collective event
  useEffect(() => {
    if (!canUseCloudLocations) {
      setCloudLocations([]);
      return;
    }

    const colRef = collection(db, 'countdowns', event.id, 'locations');
    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const list = snap.docs.map((d) => {
          const data = d.data() as ParticipantLocation;
          return {
            ...data,
            uid: data.uid || d.id,
            updatedAtMs: parseTimestampMs(data.updatedAt),
          };
        });
        setCloudLocations(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `countdowns/${event.id}/locations`);
      }
    );

    return () => unsub();
  }, [canUseCloudLocations, event.id]);

  const persistCloudLocation = useCallback(
    async (lat: number, lng: number, accuracy?: number, force = false) => {
      if (!canUseCloudLocations) return;

      const now = Date.now();
      const prev = lastCloudSyncRef.current;
      if (!force && prev) {
        const elapsed = now - prev.time;
        const moved = haversineDistanceMeters(prev.lat, prev.lng, lat, lng);
        if (elapsed < FIRESTORE_THROTTLE_MS && moved < FIRESTORE_MIN_MOVE_METERS) {
          return;
        }
      }

      lastCloudSyncRef.current = { time: now, lat, lng };
      const safeName =
        currentUserName.trim().slice(0, FIELD_LIMITS.ownerNameMax) || 'Participant';

      const payload: Record<string, unknown> = {
        uid: currentUserId,
        displayName: safeName,
        lat,
        lng,
        updatedAt: serverTimestamp(),
      };
      if (typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0) {
        payload.accuracy = Math.min(100000, Math.round(accuracy));
      }

      try {
        await setDoc(doc(db, 'countdowns', event.id, 'locations', currentUserId), payload);
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.WRITE,
          `countdowns/${event.id}/locations/${currentUserId}`
        );
      }
    },
    [canUseCloudLocations, currentUserId, currentUserName, event.id]
  );

  // If WebSocket reconnects while sharing is active, re-emit current position immediately
  useEffect(() => {
    if (sharing && wsConnected && myPosition) {
      sendLocationUpdate(myPosition.lat, myPosition.lng, myPosition.accuracy);
    }
  }, [sharing, wsConnected, myPosition, sendLocationUpdate]);

  const stopSharing = useCallback(async () => {
    if (watchIdRef.current !== null && geoSupported) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setSharing(false);
    lastCloudSyncRef.current = null;
    sendLocationStop();

    const targetEventId = sharingEventIdRef.current || event.id;
    sharingEventIdRef.current = null;

    if (isAuthenticated && !event.isLocalOnly && event.scope === 'collective') {
      try {
        await deleteDoc(doc(db, 'countdowns', targetEventId, 'locations', currentUserId));
      } catch {
        // Non-blocking if doc already deleted or user left
      }
    }
  }, [
    currentUserId,
    event.id,
    event.isLocalOnly,
    event.scope,
    geoSupported,
    isAuthenticated,
    sendLocationStop,
  ]);

  // Stop active watch and reset state when switching events or unmounting
  useEffect(() => {
    setSharing(false);
    setLocating(false);
    setGeoError(null);
    lastCloudSyncRef.current = null;

    return () => {
      if (watchIdRef.current !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      sendLocationStop();
    };
  }, [event.id, sendLocationStop]);

  // Locate user once without sharing (to calculate distance to nearby collective participants)
  const locateMeOnce = useCallback(() => {
    if (!geoSupported) {
      setGeoError('La géolocalisation n’est pas prise en charge par ce navigateur.');
      return;
    }

    setGeoError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMyPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setLocating(false);
      },
      (err) => {
        setGeoError(getGeolocationErrorMessage(err));
        setLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 30_000,
      }
    );
  }, [geoSupported]);

  // Explicit opt-in live location sharing with collective members
  const startSharing = useCallback(async () => {
    if (!geoSupported) {
      setGeoError('La géolocalisation n’est pas prise en charge par ce navigateur.');
      return;
    }
    if (event.scope !== 'collective') return;

    setGeoError(null);
    setLocating(true);

    if (isAuthenticated && !event.isLocalOnly && !isMember && onEnsureMember) {
      try {
        await onEnsureMember();
      } catch {
        setLocating(false);
        setGeoError("Rejoignez d'abord l'événement collectif pour partager votre position.");
        return;
      }
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    sharingEventIdRef.current = event.id;
    let firstFix = true;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;

        setMyPosition({ lat, lng, accuracy });
        setSharing(true);
        setLocating(false);
        setGeoError(null);

        sendLocationUpdate(lat, lng, accuracy);
        void persistCloudLocation(lat, lng, accuracy, firstFix);
        firstFix = false;
      },
      (err) => {
        setGeoError(getGeolocationErrorMessage(err));
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          void stopSharing();
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 10_000,
      }
    );
  }, [
    event.id,
    event.isLocalOnly,
    event.scope,
    geoSupported,
    isAuthenticated,
    isMember,
    onEnsureMember,
    persistCloudLocation,
    sendLocationUpdate,
    stopSharing,
  ]);

  // Merge Firestore + WebSocket live locations, compute distances, and sort nearest-first
  const mergedParticipants = useMemo<NearbyParticipant[]>(() => {
    if (event.scope !== 'collective') return [];

    const now = Date.now();
    const byUid: Record<string, NearbyParticipant> = {};

    const consider = (
      entry: ParticipantLocation,
      source: 'live' | 'cloud'
    ) => {
      const updatedMs = entry.updatedAtMs ?? Date.now();
      if (now - updatedMs > STALE_LOCATION_MS) return;

      const existing = byUid[entry.uid];
      if (existing && (existing.updatedAtMs ?? 0) > updatedMs) {
        return;
      }

      const distanceMeters = myPosition
        ? haversineDistanceMeters(myPosition.lat, myPosition.lng, entry.lat, entry.lng)
        : null;

      byUid[entry.uid] = {
        ...entry,
        updatedAtMs: updatedMs,
        isSelf: entry.uid === currentUserId,
        distanceMeters,
        source,
      };
    };

    for (const loc of cloudLocations) {
      consider(loc, 'cloud');
    }
    for (const loc of peerLocations) {
      consider(loc, 'live');
    }
    if (sharing && myPosition) {
      consider(
        {
          uid: currentUserId,
          displayName: currentUserName,
          lat: myPosition.lat,
          lng: myPosition.lng,
          accuracy: myPosition.accuracy,
          updatedAtMs: now,
        },
        'live'
      );
    }

    return Object.values(byUid).sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? 1 : -1; // Show other people before self
      if (a.distanceMeters !== null && b.distanceMeters !== null) {
        return a.distanceMeters - b.distanceMeters;
      }
      if (a.distanceMeters !== null) return -1;
      if (b.distanceMeters !== null) return 1;
      return (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0);
    });
  }, [
    cloudLocations,
    currentUserId,
    currentUserName,
    event.scope,
    myPosition,
    peerLocations,
    sharing,
  ]);

  return {
    geoSupported,
    myPosition,
    sharing,
    locating,
    geoError,
    participantsWithLocation: mergedParticipants,
    locateMeOnce,
    startSharing,
    stopSharing,
  };
}
