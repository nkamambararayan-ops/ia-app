import { useCallback, useEffect, useRef, useState } from 'react';
import { CountdownEvent } from '../types';

export type BrowserNotificationPermission = NotificationPermission | 'unsupported';

const NOTIF_ENABLED_KEY = 'chronosphere_notif_enabled_v1';
const NOTIFIED_SIGS_KEY = 'chronosphere_notified_events_v1';
const MUTED_EVENTS_KEY = 'chronosphere_muted_notifications_v1';
const MAX_STORED_SIGNATURES = 200;
const INITIAL_GRACE_MS = 15_000;

interface UseCountdownNotificationsOptions {
  events: CountdownEvent[];
  nowMs: number;
  onToast: (message: string) => void;
  onSelectEvent?: (eventId: string) => void;
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function readStoredSignatures(): string[] {
  try {
    const raw = localStorage.getItem(NOTIFIED_SIGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeStoredSignatures(sigs: string[]) {
  try {
    const trimmed = sigs.slice(-MAX_STORED_SIGNATURES);
    localStorage.setItem(NOTIFIED_SIGS_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage quota errors
  }
}

function readMutedEvents(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(MUTED_EVENTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, boolean>;
    }
    return {};
  } catch {
    return {};
  }
}

function playNotificationChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playTone = (freq: number, startOffset: number, duration: number, peakGain: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);

      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };

    playTone(587.33, 0, 0.35, 0.08); // D5
    playTone(880.0, 0.12, 0.5, 0.09); // A5

    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 900);
  } catch {
    // Audio playback can be blocked prior to user interaction; ignore cleanly
  }
}

async function getReadyServiceWorker(timeoutMs = 1200): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;

    return await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

export function useCountdownNotifications({
  events,
  nowMs,
  onToast,
  onSelectEvent,
}: UseCountdownNotificationsOptions) {
  const isSupported = typeof window !== 'undefined' && 'Notification' in window;

  const [permission, setPermission] = useState<BrowserNotificationPermission>(() => {
    if (!isSupported) return 'unsupported';
    return Notification.permission;
  });

  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() =>
    readStoredBoolean(NOTIF_ENABLED_KEY, true)
  );

  const [mutedEvents, setMutedEvents] = useState<Record<string, boolean>>(() =>
    readMutedEvents()
  );

  const notifiedSigsRef = useRef<Set<string>>(new Set(readStoredSignatures()));
  const prevRemainingRef = useRef<Map<string, number>>(new Map());

  // Sync permission state if user updates browser settings outside the page
  useEffect(() => {
    if (!isSupported) return;
    const syncPermission = () => {
      setPermission(Notification.permission);
    };
    document.addEventListener('visibilitychange', syncPermission);
    window.addEventListener('focus', syncPermission);
    return () => {
      document.removeEventListener('visibilitychange', syncPermission);
      window.removeEventListener('focus', syncPermission);
    };
  }, [isSupported]);

  const sendBrowserNotification = useCallback(
    async (title: string, body: string, eventId?: string): Promise<boolean> => {
      if (!isSupported || Notification.permission !== 'granted') {
        return false;
      }

      const tag = eventId ? `chronosphere-done-${eventId}` : 'chronosphere-test';
      const options: NotificationOptions & { renotify?: boolean } = {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag,
        renotify: true,
        data: { eventId },
      };

      try {
        const reg = await getReadyServiceWorker();
        if (reg && typeof reg.showNotification === 'function') {
          await reg.showNotification(title, options);
          return true;
        }
      } catch {
        // Fallback to standard window.Notification constructor below
      }

      try {
        const notification = new Notification(title, options);
        notification.onclick = () => {
          window.focus();
          if (eventId) {
            onSelectEvent?.(eventId);
          }
          notification.close();
        };
        return true;
      } catch {
        return false;
      }
    },
    [isSupported, onSelectEvent]
  );

  const requestPermissionAndEnable = useCallback(async () => {
    if (!isSupported) {
      onToast(
        "Ce navigateur ne prend pas en charge les notifications système ; les alertes visuelles restent actives dans l'application."
      );
      return;
    }

    if (Notification.permission === 'denied') {
      setPermission('denied');
      onToast(
        'Les notifications sont bloquées par votre navigateur. Autorisez-les dans les paramètres du site.'
      );
      return;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);

      if (result === 'granted') {
        setNotificationsEnabled(true);
        try {
          localStorage.setItem(NOTIF_ENABLED_KEY, 'true');
        } catch {
          // Ignore
        }
        playNotificationChime();
        await sendBrowserNotification(
          'Alertes ChronoSphere activées',
          'Vous serez prévenu dès qu’un compte à rebours arrivera à son terme.'
        );
        onToast('Notifications du navigateur activées.');
      } else if (result === 'denied') {
        onToast(
          'Permission refusée. Les alertes visuelles resteront affichées dans ChronoSphere.'
        );
      } else {
        onToast('Demande de notification ignorée pour le moment.');
      }
    } catch {
      onToast('Impossible de demander la permission de notification dans cet environnement.');
    }
  }, [isSupported, onToast, sendBrowserNotification]);

  const toggleGlobalNotifications = useCallback(async () => {
    if (!isSupported) {
      onToast("Notifications système indisponibles sur ce navigateur ; alertes internes actives.");
      return;
    }

    if (permission === 'default') {
      await requestPermissionAndEnable();
      return;
    }

    if (permission === 'denied') {
      onToast(
        'Les notifications sont bloquées dans les réglages de votre navigateur pour ce site.'
      );
      return;
    }

    setNotificationsEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NOTIF_ENABLED_KEY, String(next));
      } catch {
        // Ignore
      }
      onToast(
        next
          ? 'Alertes navigateur réactivées.'
          : 'Alertes navigateur mises en pause.'
      );
      return next;
    });
  }, [isSupported, onToast, permission, requestPermissionAndEnable]);

  const testNotification = useCallback(async () => {
    playNotificationChime();

    if (!isSupported || permission !== 'granted') {
      if (permission === 'default') {
        await requestPermissionAndEnable();
        return;
      }
      onToast('Test d’alerte interne : un compte à rebours vient de se terminer.');
      return;
    }

    const delivered = await sendBrowserNotification(
      'ChronoSphere · Notification de test',
      'Vos alertes navigateur fonctionnent correctement pour vos échéances.'
    );
    onToast(
      delivered
        ? 'Notification de test envoyée.'
        : 'Alerte affichée dans l’application (fenêtre système bloquée).'
    );
  }, [isSupported, onToast, permission, requestPermissionAndEnable, sendBrowserNotification]);

  const isEventMuted = useCallback(
    (eventId: string) => Boolean(mutedEvents[eventId]),
    [mutedEvents]
  );

  const toggleEventMute = useCallback(
    (eventId: string, eventTitle?: string) => {
      setMutedEvents((prev) => {
        const nextMuted = !prev[eventId];
        const updated = { ...prev };
        if (nextMuted) {
          updated[eventId] = true;
        } else {
          delete updated[eventId];
        }
        try {
          localStorage.setItem(MUTED_EVENTS_KEY, JSON.stringify(updated));
        } catch {
          // Ignore
        }
        onToast(
          nextMuted
            ? `Alerte coupée pour « ${eventTitle || 'cet événement'} ».`
            : `Alerte réactivée pour « ${eventTitle || 'cet événement'} ».`
        );
        return updated;
      });
    },
    [onToast]
  );

  // Watch all active countdowns and fire alert exactly once when each reaches 0
  useEffect(() => {
    let storageDirty = false;
    const activeSignatures = new Set<string>();

    for (const ev of events) {
      if (ev.status !== 'active') continue;

      const targetMs = new Date(ev.targetIso).getTime();
      if (Number.isNaN(targetMs)) continue;

      const signature = `${ev.id}:${ev.targetIso}`;
      activeSignatures.add(signature);

      const remainingMs = targetMs - nowMs;
      const prevRemaining = prevRemainingRef.current.get(signature);
      prevRemainingRef.current.set(signature, remainingMs);

      if (remainingMs > 0) {
        continue;
      }

      if (notifiedSigsRef.current.has(signature)) {
        continue;
      }

      const elapsedSinceTarget = nowMs - targetMs;
      const transitionedLive = prevRemaining !== undefined && prevRemaining > 0;
      const withinInitialGrace = prevRemaining === undefined && elapsedSinceTarget <= INITIAL_GRACE_MS;

      // Mark acknowledged immediately to prevent duplicate notifications
      notifiedSigsRef.current.add(signature);
      storageDirty = true;

      // Skip historical events that were already expired long before opening the app
      if (!transitionedLive && !withinInitialGrace) {
        continue;
      }

      // Respect per-event mute preference
      if (mutedEvents[ev.id]) {
        continue;
      }

      const bodyParts = [
        ev.scope === 'collective' ? 'Événement collectif arrivé à échéance.' : 'Votre compte à rebours est terminé.',
      ];
      if (ev.locationName) {
        bodyParts.push(`Lieu : ${ev.locationName}`);
      }

      onToast(`Échéance atteinte : « ${ev.title} » est arrivé à son terme.`);
      playNotificationChime();

      if (notificationsEnabled && isSupported && Notification.permission === 'granted') {
        void sendBrowserNotification(
          `Compte à rebours terminé · ${ev.title}`,
          bodyParts.join(' '),
          ev.id
        );
      }
    }

    // Prune stale signatures from the in-memory transition map
    for (const key of prevRemainingRef.current.keys()) {
      if (!activeSignatures.has(key)) {
        prevRemainingRef.current.delete(key);
      }
    }

    if (storageDirty) {
      writeStoredSignatures(Array.from(notifiedSigsRef.current));
    }
  }, [
    events,
    nowMs,
    mutedEvents,
    notificationsEnabled,
    isSupported,
    onToast,
    sendBrowserNotification,
  ]);

  return {
    isSupported,
    permission,
    notificationsEnabled,
    requestPermissionAndEnable,
    toggleGlobalNotifications,
    testNotification,
    isEventMuted,
    toggleEventMute,
  };
}
