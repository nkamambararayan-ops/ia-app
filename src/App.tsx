import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Bell,
  BellOff,
  BellRing,
  Calendar,
  Clock,
  KeyRound,
  Lock,
  LogOut,
  MapPin,
  Moon,
  Plus,
  Search,
  Sun,
  Users,
} from 'lucide-react';
import {
  CATEGORY_LABELS,
  CountdownCategory,
  CountdownEvent,
  CountdownScope,
  CountdownStatus,
  CoverKey,
  FIELD_LIMITS,
  GoogleCalendarEventItem,
  GroundingLink,
  GuestMessage,
  Milestone,
  RsvpEntry,
  RsvpStatus,
  SavedResearchNote,
  SavedSoundtrack,
} from './types';
import {
  auth,
  connectGoogleCalendar,
  db,
  getCalendarAccessToken,
  handleFirestoreError,
  OperationType,
  signInPrimaryWithGoogle,
  signOutPrimary,
  testFirestoreConnection,
} from './lib/firebase';
import { createGoogleCalendarEvent } from './lib/calendarApi';
import {
  formatShortDate,
  generateSafeId,
  generateShareCode,
  getTimeRemaining,
} from './lib/time';
import { CountdownClock } from './components/CountdownClock';
import { CreateEventModal } from './components/CreateEventModal';
import { EventDetailPanel } from './components/EventDetailPanel';
import { EventMapPanel } from './components/EventMapPanel';
import {
  CalendarExportConfirmModal,
  CalendarSyncModal,
  GoogleSignInButton,
} from './components/CalendarSyncModal';
import { OfflineIndicator, PWAInstallButton } from './components/PWAWidgets';
import { useCountdownNotifications } from './hooks/useCountdownNotifications';

type MainNavView = 'dashboard' | 'collective' | 'map';
type FilterMode = 'all' | 'personal' | 'collective' | 'archived';
type ThemePreference = 'system' | 'light' | 'dark';

interface LocalEventMeta {
  milestones: Milestone[];
  rsvps: RsvpEntry[];
  messages: GuestMessage[];
}

const LOCAL_EVENTS_KEY = 'chronosphere_local_events_v1';
const LOCAL_META_KEY = 'chronosphere_local_meta_v1';
const THEME_STORAGE_KEY = 'chronosphere_theme_v1';

function createStarterLocalEvents(): CountdownEvent[] {
  const now = Date.now();
  const in14Days = new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString();
  const in32Days = new Date(now + 32 * 24 * 60 * 60 * 1000).toISOString();
  const created = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

  return [
    {
      id: 'local_starter_collective',
      ownerId: 'local_guest',
      ownerName: 'Vous (Mode local)',
      title: 'Soirée d’été sur la Seine',
      description:
        'Retrouvailles collectives au coucher du soleil. Partagez ce compte à rebours avec vos proches pour suivre les jalons et confirmer votre présence.',
      targetIso: in14Days,
      createdIso: created,
      scope: 'collective',
      category: 'celebration',
      accentColor: '#d97706',
      coverKey: 'celebration',
      shareCode: 'ETE2026',
      participantIds: ['local_guest'],
      locationName: 'Berges de Seine, Paris',
      locationAddress: 'Port des Invalides, 75007 Paris, France',
      locationLat: 48.8627,
      locationLng: 2.3125,
      status: 'active',
      isLocalOnly: true,
    },
    {
      id: 'local_starter_personal',
      ownerId: 'local_guest',
      ownerName: 'Vous (Mode local)',
      title: 'Départ Grand Horizon',
      description:
        'Objectif personnel : boucler les préparatifs, vérifier le passeport et décoller sereinement.',
      targetIso: in32Days,
      createdIso: created,
      scope: 'personal',
      category: 'voyage',
      accentColor: '#0284c7',
      coverKey: 'voyage',
      shareCode: 'VOYAGE26',
      participantIds: ['local_guest'],
      status: 'active',
      isLocalOnly: true,
    },
  ];
}

function loadLocalEvents(): CountdownEvent[] {
  try {
    const raw = localStorage.getItem(LOCAL_EVENTS_KEY);
    if (!raw) {
      const seeded = createStarterLocalEvents();
      localStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalEvents(events: CountdownEvent[]) {
  try {
    localStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify(events));
  } catch {
    // Ignore storage quota errors
  }
}

function loadLocalMetaMap(): Record<string, LocalEventMeta> {
  try {
    const raw = localStorage.getItem(LOCAL_META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalMetaMap(map: Record<string, LocalEventMeta>) {
  try {
    localStorage.setItem(LOCAL_META_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

function AppContent({
  mapsApiKey,
  aiEnabled,
  quotaExceeded,
}: {
  mapsApiKey: string;
  aiEnabled: boolean;
  quotaExceeded: boolean;
}) {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'dark' || stored === 'light' || stored === 'system') {
        return stored;
      }
      return 'system';
    } catch {
      return 'system';
    }
  });

  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    try {
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      if (event.newValue === 'dark' || event.newValue === 'light' || event.newValue === 'system') {
        setThemePreference(event.newValue);
      } else {
        setThemePreference('system');
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const darkMode =
    themePreference === 'system' ? systemPrefersDark : themePreference === 'dark';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light';
    try {
      if (themePreference === 'system') {
        localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        localStorage.setItem(THEME_STORAGE_KEY, themePreference);
      }
    } catch {
      // Ignore
    }
  }, [darkMode, themePreference]);

  const handleToggleDarkMode = useCallback(() => {
    const nextDark = !darkMode;
    setThemePreference(nextDark === systemPrefersDark ? 'system' : nextDark ? 'dark' : 'light');
  }, [darkMode, systemPrefersDark]);

  // Live 1-second ticker for all countdowns
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  // Events state (cloud + local)
  const [ownedCloudEvents, setOwnedCloudEvents] = useState<CountdownEvent[]>([]);
  const [collectiveCloudEvents, setCollectiveCloudEvents] = useState<CountdownEvent[]>([]);
  const [localEvents, setLocalEvents] = useState<CountdownEvent[]>(() => loadLocalEvents());
  const [localMetaMap, setLocalMetaMap] = useState<Record<string, LocalEventMeta>>(() =>
    loadLocalMetaMap()
  );

  // Subcollections for selected cloud event
  const [cloudMilestones, setCloudMilestones] = useState<Milestone[]>([]);
  const [cloudRsvps, setCloudRsvps] = useState<RsvpEntry[]>([]);
  const [cloudMessages, setCloudMessages] = useState<GuestMessage[]>([]);

  // Saved soundtracks & research notes for selected event (authenticated persistence)
  const [savedSoundtracks, setSavedSoundtracks] = useState<SavedSoundtrack[]>([]);
  const [savedResearchNotes, setSavedResearchNotes] = useState<SavedResearchNote[]>([]);

  // Navigation & UI state
  const [mainView, setMainView] = useState<MainNavView>('dashboard');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CountdownEvent | null>(null);
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [exportCandidate, setExportCandidate] = useState<CountdownEvent | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 4000);
  }, []);

  // Initial Firestore connection verification
  useEffect(() => {
    void testFirestoreConnection();
  }, []);

  // Auth listener & user profile sync
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        const safeName =
          (nextUser.displayName || nextUser.email?.split('@')[0] || 'Utilisateur')
            .trim()
            .slice(0, FIELD_LIMITS.ownerNameMax) || 'Utilisateur';
        const userRef = doc(db, 'users', nextUser.uid);
        try {
          const snap = await getDoc(userRef);
          if (!snap.exists()) {
            const payload: Record<string, unknown> = {
              uid: nextUser.uid,
              displayName: safeName,
              createdAt: serverTimestamp(),
            };
            if (nextUser.photoURL && nextUser.photoURL.length <= 500) {
              payload.photoUrl = nextUser.photoURL;
            }
            await setDoc(userRef, payload);
          } else {
            const updatePayload: Record<string, unknown> = {
              displayName: safeName,
            };
            if (nextUser.photoURL && nextUser.photoURL.length <= 500) {
              updatePayload.photoUrl = nextUser.photoURL;
            }
            await updateDoc(userRef, updatePayload);
          }
        } catch (err) {
          console.error('User profile sync error:', err);
        }
      } else {
        setOwnedCloudEvents([]);
        setCollectiveCloudEvents([]);
      }
    });
    return () => unsub();
  }, []);

  // Dual Firestore listeners (strictly gated on authReady && user)
  useEffect(() => {
    if (!authReady || !user) return;

    const qOwned = query(collection(db, 'countdowns'), where('ownerId', '==', user.uid));
    const qCollective = query(collection(db, 'countdowns'), where('scope', '==', 'collective'));

    const unsubOwned = onSnapshot(
      qOwned,
      (snap) => {
        const list: CountdownEvent[] = snap.docs.map((d) => ({
          ...(d.data() as CountdownEvent),
          id: d.id,
        }));
        setOwnedCloudEvents(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'countdowns');
      }
    );

    const unsubCollective = onSnapshot(
      qCollective,
      (snap) => {
        const list: CountdownEvent[] = snap.docs.map((d) => ({
          ...(d.data() as CountdownEvent),
          id: d.id,
        }));
        setCollectiveCloudEvents(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'countdowns');
      }
    );

    return () => {
      unsubOwned();
      unsubCollective();
    };
  }, [authReady, user]);

  // Combined deduplicated events list
  const allEvents = useMemo(() => {
    const byId = new Map<string, CountdownEvent>();
    for (const ev of localEvents) {
      byId.set(ev.id, ev);
    }
    for (const ev of collectiveCloudEvents) {
      byId.set(ev.id, ev);
    }
    for (const ev of ownedCloudEvents) {
      byId.set(ev.id, ev);
    }
    return Array.from(byId.values()).sort(
      (a, b) => new Date(a.targetIso).getTime() - new Date(b.targetIso).getTime()
    );
  }, [localEvents, collectiveCloudEvents, ownedCloudEvents]);

  // Select default event when list loads
  useEffect(() => {
    if (allEvents.length === 0) {
      setSelectedEventId(null);
      return;
    }
    if (!selectedEventId || !allEvents.some((e) => e.id === selectedEventId)) {
      setSelectedEventId(allEvents[0].id);
    }
  }, [allEvents, selectedEventId]);

  const selectedEvent = useMemo(
    () => allEvents.find((e) => e.id === selectedEventId) ?? null,
    [allEvents, selectedEventId]
  );

  const handleSelectNotifiedEvent = useCallback((eventId: string) => {
    setSelectedEventId(eventId);
    setMainView('dashboard');
  }, []);

  const {
    isSupported: notifSupported,
    permission: notifPermission,
    notificationsEnabled,
    toggleGlobalNotifications,
    testNotification,
    isEventMuted,
    toggleEventMute,
  } = useCountdownNotifications({
    events: allEvents,
    nowMs,
    onToast: showToast,
    onSelectEvent: handleSelectNotifiedEvent,
  });

  // URL Deep-link support (/?event=...&code=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const eventParam = params.get('event');
    const codeParam = params.get('code');
    if (!eventParam && !codeParam) return;

    const matchLocal = allEvents.find(
      (e) =>
        (eventParam && e.id === eventParam) ||
        (codeParam && e.shareCode.toUpperCase() === codeParam.toUpperCase())
    );
    if (matchLocal) {
      setSelectedEventId(matchLocal.id);
      if (matchLocal.scope === 'collective') {
        setMainView('collective');
      }
      return;
    }

    if (authReady && user && eventParam) {
      void (async () => {
        try {
          const snap = await getDoc(doc(db, 'countdowns', eventParam));
          if (snap.exists()) {
            const ev = { ...(snap.data() as CountdownEvent), id: snap.id };
            if (ev.scope === 'collective' && !ev.participantIds.includes(user.uid)) {
              await updateDoc(doc(db, 'countdowns', ev.id), {
                participantIds: arrayUnion(user.uid),
                updatedAt: serverTimestamp(),
              });
            }
            setSelectedEventId(ev.id);
            setMainView('collective');
          }
        } catch (err) {
          console.error('Deep link lookup failed:', err);
        }
      })();
    }
  }, [allEvents, authReady, user]);

  // Subcollections listeners for selected cloud event
  useEffect(() => {
    if (!selectedEvent || selectedEvent.isLocalOnly || !user) {
      setCloudMilestones([]);
      setCloudRsvps([]);
      setCloudMessages([]);
      return;
    }

    const evId = selectedEvent.id;
    const unsubM = onSnapshot(
      query(collection(db, 'countdowns', evId, 'milestones'), orderBy('createdAt', 'asc')),
      (snap) => {
        setCloudMilestones(
          snap.docs.map((d) => ({ ...(d.data() as Milestone), id: d.id }))
        );
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `countdowns/${evId}/milestones`);
      }
    );

    const unsubR = onSnapshot(
      collection(db, 'countdowns', evId, 'rsvps'),
      (snap) => {
        setCloudRsvps(snap.docs.map((d) => d.data() as RsvpEntry));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `countdowns/${evId}/rsvps`);
      }
    );

    const unsubMsg = onSnapshot(
      query(collection(db, 'countdowns', evId, 'messages'), orderBy('createdAt', 'desc')),
      (snap) => {
        setCloudMessages(
          snap.docs.map((d) => ({ ...(d.data() as GuestMessage), id: d.id }))
        );
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `countdowns/${evId}/messages`);
      }
    );

    return () => {
      unsubM();
      unsubR();
      unsubMsg();
    };
  }, [selectedEvent, user]);

  // Load saved soundtracks & research notes for authenticated user and selected event
  const loadSqlWorkspace = useCallback(
    async (activeUser: User, eventId: string) => {
      try {
        const token = await activeUser.getIdToken();
        const res = await fetch(
          `/api/sql/workspace?eventId=${encodeURIComponent(eventId)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          soundtracks?: SavedSoundtrack[];
          researchNotes?: SavedResearchNote[];
        };
        setSavedSoundtracks(Array.isArray(data.soundtracks) ? data.soundtracks : []);
        setSavedResearchNotes(Array.isArray(data.researchNotes) ? data.researchNotes : []);
      } catch {
        // Keep current state gracefully if offline or temporarily unreachable
      }
    },
    []
  );

  useEffect(() => {
    if (!user || !selectedEvent?.id) {
      setSavedSoundtracks([]);
      setSavedResearchNotes([]);
      return;
    }
    void loadSqlWorkspace(user, selectedEvent.id);
  }, [user, selectedEvent?.id, loadSqlWorkspace]);

  const logActivityFireAndForget = useCallback(
    async (eventId: string, actionType: string, details: string) => {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        await fetch('/api/sql/activity', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ eventId, actionType, details }),
        });
      } catch {
        // Non-blocking activity log
      }
    },
    [user]
  );

  const currentUserId = user?.uid || 'local_guest';
  const currentUserName =
    (user?.displayName || user?.email?.split('@')[0] || 'Participant').slice(
      0,
      FIELD_LIMITS.ownerNameMax
    );

  const activeMilestones = useMemo(() => {
    if (!selectedEvent) return [];
    if (selectedEvent.isLocalOnly) {
      return localMetaMap[selectedEvent.id]?.milestones || [];
    }
    return cloudMilestones;
  }, [selectedEvent, localMetaMap, cloudMilestones]);

  const activeRsvps = useMemo(() => {
    if (!selectedEvent) return [];
    if (selectedEvent.isLocalOnly) {
      return localMetaMap[selectedEvent.id]?.rsvps || [];
    }
    return cloudRsvps;
  }, [selectedEvent, localMetaMap, cloudRsvps]);

  const activeMessages = useMemo(() => {
    if (!selectedEvent) return [];
    if (selectedEvent.isLocalOnly) {
      return localMetaMap[selectedEvent.id]?.messages || [];
    }
    return cloudMessages;
  }, [selectedEvent, localMetaMap, cloudMessages]);

  // Filtered events list for sidebar
  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allEvents.filter((ev) => {
      if (mainView === 'collective' && ev.scope !== 'collective') return false;

      if (filterMode === 'archived') {
        if (ev.status !== 'archived') return false;
      } else {
        if (ev.status === 'archived') return false;
        if (filterMode === 'personal' && ev.scope !== 'personal') return false;
        if (filterMode === 'collective' && ev.scope !== 'collective') return false;
      }

      if (q) {
        const hay = `${ev.title} ${ev.description || ''} ${ev.locationName || ''} ${ev.locationAddress || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allEvents, mainView, filterMode, searchQuery]);

  // Summary metrics
  const metrics = useMemo(() => {
    const active = allEvents.filter((e) => e.status === 'active');
    const collectives = active.filter((e) => e.scope === 'collective');
    const upcoming = active
      .filter((e) => new Date(e.targetIso).getTime() > nowMs)
      .sort((a, b) => new Date(a.targetIso).getTime() - new Date(b.targetIso).getTime())[0];

    return {
      activeCount: active.length,
      collectiveCount: collectives.length,
      upcoming,
      upcomingRem: upcoming ? getTimeRemaining(upcoming.targetIso, upcoming.createdIso, nowMs) : null,
    };
  }, [allEvents, nowMs]);

  const handleSignIn = async () => {
    setAuthLoading(true);
    try {
      await signInPrimaryWithGoogle();
      showToast('Connecté avec Google — synchronisation cloud active.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Connexion annulée.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOutPrimary();
    showToast('Déconnecté — passage en mode local.');
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) return;

    const localMatch = allEvents.find((ev) => ev.shareCode.toUpperCase() === code);
    if (localMatch) {
      setSelectedEventId(localMatch.id);
      setMainView('dashboard');
      setJoinCodeInput('');
      if (user && !localMatch.isLocalOnly && localMatch.scope === 'collective') {
        await handleJoinCollective(localMatch);
      }
      showToast(`Événement « ${localMatch.title} » ouvert.`);
      return;
    }

    if (!user) {
      showToast("Connectez-vous avec Google pour rejoindre un événement collectif en ligne.");
      return;
    }

    try {
      const snap = await getDocs(
        query(
          collection(db, 'countdowns'),
          where('scope', '==', 'collective'),
          where('shareCode', '==', code)
        )
      );
      if (snap.empty) {
        showToast(`Aucun événement collectif trouvé pour le code ${code}.`);
        return;
      }
      const d = snap.docs[0];
      const ev = { ...(d.data() as CountdownEvent), id: d.id };
      if (!ev.participantIds.includes(user.uid)) {
        await updateDoc(doc(db, 'countdowns', ev.id), {
          participantIds: arrayUnion(user.uid),
          updatedAt: serverTimestamp(),
        });
      }
      setSelectedEventId(ev.id);
      setMainView('collective');
      setJoinCodeInput('');
      showToast(`Vous avez rejoint « ${ev.title} ».`);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'countdowns');
    }
  };

  const handleSaveEvent = async (payload: {
    title: string;
    description: string;
    targetIso: string;
    scope: CountdownScope;
    category: CountdownCategory;
    coverKey: CoverKey;
    accentColor: string;
    locationName?: string;
    locationAddress?: string;
    locationLat?: number;
    locationLng?: number;
    placeId?: string;
  }) => {
    if (editingEvent) {
      if (editingEvent.isLocalOnly || !user) {
        const updated: CountdownEvent = {
          ...editingEvent,
          ...payload,
        };
        const nextLocal = localEvents.map((e) => (e.id === editingEvent.id ? updated : e));
        setLocalEvents(nextLocal);
        saveLocalEvents(nextLocal);
        setSelectedEventId(updated.id);
        setEditingEvent(null);
        showToast('Compte à rebours mis à jour.');
        return;
      }

      const evRef = doc(db, 'countdowns', editingEvent.id);
      const updateDocData: Record<string, unknown> = {
        title: payload.title,
        description: payload.description,
        targetIso: payload.targetIso,
        scope: payload.scope,
        category: payload.category,
        coverKey: payload.coverKey,
        accentColor: payload.accentColor,
        updatedAt: serverTimestamp(),
      };

      if (payload.locationName) updateDocData.locationName = payload.locationName;
      else if (editingEvent.locationName) updateDocData.locationName = deleteField();

      if (payload.locationAddress) updateDocData.locationAddress = payload.locationAddress;
      else if (editingEvent.locationAddress) updateDocData.locationAddress = deleteField();

      if (typeof payload.locationLat === 'number' && typeof payload.locationLng === 'number') {
        updateDocData.locationLat = payload.locationLat;
        updateDocData.locationLng = payload.locationLng;
      } else if (typeof editingEvent.locationLat === 'number') {
        updateDocData.locationLat = deleteField();
        updateDocData.locationLng = deleteField();
      }

      if (payload.placeId) updateDocData.placeId = payload.placeId;
      else if (editingEvent.placeId) updateDocData.placeId = deleteField();

      try {
        await updateDoc(evRef, updateDocData);
        setEditingEvent(null);
        showToast('Compte à rebours mis à jour.');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `countdowns/${editingEvent.id}`);
      }
      return;
    }

    const newId = generateSafeId('evt');
    const createdIso = new Date().toISOString();
    const shareCode = generateShareCode();

    if (!user) {
      const localEv: CountdownEvent = {
        id: newId,
        ownerId: 'local_guest',
        ownerName: 'Vous (Mode local)',
        title: payload.title,
        description: payload.description || undefined,
        targetIso: payload.targetIso,
        createdIso,
        scope: payload.scope,
        category: payload.category,
        accentColor: payload.accentColor,
        coverKey: payload.coverKey,
        shareCode,
        participantIds: ['local_guest'],
        locationName: payload.locationName,
        locationAddress: payload.locationAddress,
        locationLat: payload.locationLat,
        locationLng: payload.locationLng,
        placeId: payload.placeId,
        status: 'active',
        isLocalOnly: true,
      };
      const nextLocal = [localEv, ...localEvents];
      setLocalEvents(nextLocal);
      saveLocalEvents(nextLocal);
      setSelectedEventId(localEv.id);
      showToast('Compte à rebours créé en mode local.');
      return;
    }

    const firestorePayload: Record<string, unknown> = {
      id: newId,
      ownerId: user.uid,
      ownerName: currentUserName,
      title: payload.title,
      targetIso: payload.targetIso,
      createdIso,
      scope: payload.scope,
      category: payload.category,
      accentColor: payload.accentColor,
      coverKey: payload.coverKey,
      shareCode,
      participantIds: [user.uid],
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (payload.description) firestorePayload.description = payload.description;
    if (payload.locationName) firestorePayload.locationName = payload.locationName;
    if (payload.locationAddress) firestorePayload.locationAddress = payload.locationAddress;
    if (typeof payload.locationLat === 'number' && typeof payload.locationLng === 'number') {
      firestorePayload.locationLat = payload.locationLat;
      firestorePayload.locationLng = payload.locationLng;
    }
    if (payload.placeId) firestorePayload.placeId = payload.placeId;

    try {
      await setDoc(doc(db, 'countdowns', newId), firestorePayload);
      setSelectedEventId(newId);
      setMainView(payload.scope === 'collective' ? 'collective' : 'dashboard');
      void logActivityFireAndForget(newId, 'event_created', payload.title);
      showToast('Compte à rebours enregistré dans le cloud.');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `countdowns/${newId}`);
    }
  };

  const handleDeleteEvent = async (ev: CountdownEvent) => {
    if (ev.isLocalOnly || !user) {
      const next = localEvents.filter((item) => item.id !== ev.id);
      setLocalEvents(next);
      saveLocalEvents(next);
      showToast('Événement supprimé.');
      return;
    }

    try {
      await deleteDoc(doc(db, 'countdowns', ev.id));
      showToast('Événement supprimé.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `countdowns/${ev.id}`);
    }
  };

  const handleArchiveToggle = async (ev: CountdownEvent) => {
    const nextStatus: CountdownStatus = ev.status === 'archived' ? 'active' : 'archived';
    if (ev.isLocalOnly || !user) {
      const next = localEvents.map((item) =>
        item.id === ev.id ? { ...item, status: nextStatus } : item
      );
      setLocalEvents(next);
      saveLocalEvents(next);
      showToast(nextStatus === 'archived' ? 'Événement archivé.' : 'Événement réactivé.');
      return;
    }

    try {
      await updateDoc(doc(db, 'countdowns', ev.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      showToast(nextStatus === 'archived' ? 'Événement archivé.' : 'Événement réactivé.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `countdowns/${ev.id}`);
    }
  };

  const handleJoinCollective = async (ev: CountdownEvent) => {
    if (!user || ev.isLocalOnly) return;
    if (ev.participantIds.includes(user.uid)) return;
    try {
      await updateDoc(doc(db, 'countdowns', ev.id), {
        participantIds: arrayUnion(user.uid),
        updatedAt: serverTimestamp(),
      });
      void logActivityFireAndForget(ev.id, 'collective_joined', ev.title);
      showToast(`Vous participez désormais à « ${ev.title} ».`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `countdowns/${ev.id}`);
    }
  };

  const updateLocalMeta = (eventId: string, updater: (prev: LocalEventMeta) => LocalEventMeta) => {
    setLocalMetaMap((prev) => {
      const current = prev[eventId] || { milestones: [], rsvps: [], messages: [] };
      const updated = { ...prev, [eventId]: updater(current) };
      saveLocalMetaMap(updated);
      return updated;
    });
  };

  const handleAddMilestone = async (title: string, dueIso?: string) => {
    if (!selectedEvent) return;
    const mId = generateSafeId('mil');
    if (selectedEvent.isLocalOnly || !user) {
      updateLocalMeta(selectedEvent.id, (prev) => ({
        ...prev,
        milestones: [
          ...prev.milestones,
          {
            id: mId,
            title,
            dueIso,
            completed: false,
            createdBy: currentUserId,
          },
        ],
      }));
      return;
    }

    const payload: Record<string, unknown> = {
      id: mId,
      title,
      completed: false,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    };
    if (dueIso) payload.dueIso = dueIso;

    try {
      await setDoc(doc(db, 'countdowns', selectedEvent.id, 'milestones', mId), payload);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `countdowns/${selectedEvent.id}/milestones/${mId}`
      );
    }
  };

  const handleToggleMilestone = async (milestone: Milestone) => {
    if (!selectedEvent) return;
    if (selectedEvent.isLocalOnly || !user) {
      updateLocalMeta(selectedEvent.id, (prev) => ({
        ...prev,
        milestones: prev.milestones.map((m) =>
          m.id === milestone.id ? { ...m, completed: !m.completed } : m
        ),
      }));
      return;
    }

    try {
      const nextCompleted = !milestone.completed;
      await updateDoc(doc(db, 'countdowns', selectedEvent.id, 'milestones', milestone.id), {
        completed: nextCompleted,
      });
      if (nextCompleted) {
        void logActivityFireAndForget(
          selectedEvent.id,
          'milestone_completed',
          milestone.title
        );
      }
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `countdowns/${selectedEvent.id}/milestones/${milestone.id}`
      );
    }
  };

  const handleDeleteMilestone = async (milestoneId: string) => {
    if (!selectedEvent) return;
    if (selectedEvent.isLocalOnly || !user) {
      updateLocalMeta(selectedEvent.id, (prev) => ({
        ...prev,
        milestones: prev.milestones.filter((m) => m.id !== milestoneId),
      }));
      return;
    }

    try {
      await deleteDoc(doc(db, 'countdowns', selectedEvent.id, 'milestones', milestoneId));
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.DELETE,
        `countdowns/${selectedEvent.id}/milestones/${milestoneId}`
      );
    }
  };

  const handleUpdateDescription = async (description: string) => {
    if (!selectedEvent) return;
    if (selectedEvent.isLocalOnly || !user) {
      const next = localEvents.map((e) =>
        e.id === selectedEvent.id ? { ...e, description } : e
      );
      setLocalEvents(next);
      saveLocalEvents(next);
      return;
    }

    try {
      await updateDoc(doc(db, 'countdowns', selectedEvent.id), {
        description,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `countdowns/${selectedEvent.id}`);
    }
  };

  const handleSubmitRsvp = async (status: RsvpStatus, note: string) => {
    if (!selectedEvent) return;
    if (selectedEvent.isLocalOnly || !user) {
      updateLocalMeta(selectedEvent.id, (prev) => {
        const others = prev.rsvps.filter((r) => r.uid !== currentUserId);
        return {
          ...prev,
          rsvps: [
            ...others,
            {
              uid: currentUserId,
              displayName: currentUserName,
              status,
              note: note || undefined,
            },
          ],
        };
      });
      showToast('Réponse RSVP enregistrée.');
      return;
    }

    const rsvpPayload: Record<string, unknown> = {
      uid: user.uid,
      displayName: currentUserName,
      status,
      updatedAt: serverTimestamp(),
    };
    if (note) rsvpPayload.note = note.slice(0, FIELD_LIMITS.rsvpNoteMax);

    try {
      await setDoc(doc(db, 'countdowns', selectedEvent.id, 'rsvps', user.uid), rsvpPayload);
      showToast('Votre participation a été enregistrée.');
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `countdowns/${selectedEvent.id}/rsvps/${user.uid}`
      );
    }
  };

  const handlePostMessage = async (text: string, reaction?: string) => {
    if (!selectedEvent) return;
    const msgId = generateSafeId('msg');
    if (selectedEvent.isLocalOnly || !user) {
      updateLocalMeta(selectedEvent.id, (prev) => ({
        ...prev,
        messages: [
          {
            id: msgId,
            authorId: currentUserId,
            authorName: currentUserName,
            text,
            reaction,
          },
          ...prev.messages,
        ],
      }));
      return;
    }

    const msgPayload: Record<string, unknown> = {
      id: msgId,
      authorId: user.uid,
      authorName: currentUserName,
      text,
      createdAt: serverTimestamp(),
    };
    if (reaction) msgPayload.reaction = reaction;

    try {
      await setDoc(doc(db, 'countdowns', selectedEvent.id, 'messages', msgId), msgPayload);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `countdowns/${selectedEvent.id}/messages/${msgId}`
      );
    }
  };

  const handleImportCalendarEvent = async (item: GoogleCalendarEventItem) => {
    const rawIso = item.start?.dateTime || item.start?.date;
    const parsedDate = rawIso ? new Date(rawIso) : new Date(Date.now() + 7 * 86400000);
    const targetIso = Number.isNaN(parsedDate.getTime())
      ? new Date(Date.now() + 7 * 86400000).toISOString()
      : parsedDate.toISOString();

    await handleSaveEvent({
      title: (item.summary || 'Événement Google Calendar').slice(0, FIELD_LIMITS.titleMax),
      description: (item.description || '').slice(0, FIELD_LIMITS.descriptionMax),
      targetIso,
      scope: 'personal',
      category: 'other',
      coverKey: 'focus',
      accentColor: '#4f46e5',
      locationName: item.location ? item.location.slice(0, FIELD_LIMITS.locationNameMax) : undefined,
      locationAddress: item.location
        ? item.location.slice(0, FIELD_LIMITS.locationAddressMax)
        : undefined,
    });
  };

  const handleConfirmCalendarExport = async () => {
    if (!exportCandidate) return;
    setExportLoading(true);
    try {
      let token = getCalendarAccessToken();
      if (!token) {
        const res = await connectGoogleCalendar();
        token = res.accessToken;
      }
      const created = await createGoogleCalendarEvent(token, exportCandidate);
      if (
        user &&
        !exportCandidate.isLocalOnly &&
        exportCandidate.ownerId === user.uid &&
        created.id
      ) {
        await updateDoc(doc(db, 'countdowns', exportCandidate.id), {
          calendarEventId: created.id.slice(0, 160),
          updatedAt: serverTimestamp(),
        });
      }
      setExportCandidate(null);
      showToast('Événement ajouté à votre Google Calendar.');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Impossible d'exporter vers Google Calendar."
      );
    } finally {
      setExportLoading(false);
    }
  };

  const handleSaveSoundtrack = async (payload: {
    model: string;
    prompt: string;
    lyrics?: string;
    mimeType: string;
    audioDataUrl: string;
  }) => {
    if (!user || !selectedEvent) {
      showToast('Connectez-vous avec Google pour archiver une bande sonore.');
      return;
    }
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/sql/soundtracks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          eventId: selectedEvent.id,
          eventTitle: selectedEvent.title,
          ...payload,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Impossible d'enregistrer la bande sonore.");
      }
      setSavedSoundtracks((prev) => [data as SavedSoundtrack, ...prev]);
      showToast('Bande sonore archivée.');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Impossible d'enregistrer la bande sonore."
      );
    }
  };

  const handleDeleteSoundtrack = async (id: number) => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/sql/soundtracks/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Suppression impossible.');
      }
      setSavedSoundtracks((prev) => prev.filter((item) => item.id !== id));
      showToast('Bande sonore supprimée.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Suppression impossible.');
    }
  };

  const handleSaveResearch = async (payload: {
    sourceType: 'maps_grounding' | 'search_grounding' | 'live_voice';
    query: string;
    summary: string;
    links: GroundingLink[];
  }) => {
    if (!user || !selectedEvent) {
      showToast('Connectez-vous avec Google pour archiver cette fiche.');
      return;
    }
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/sql/research', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          eventId: selectedEvent.id,
          ...payload,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Impossible d'archiver la fiche.");
      }
      setSavedResearchNotes((prev) => [data as SavedResearchNote, ...prev]);
      showToast('Fiche archivée dans votre espace.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Impossible d'archiver la fiche.");
    }
  };

  const handleDeleteResearch = async (id: number) => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/sql/research/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Suppression impossible.');
      }
      setSavedResearchNotes((prev) => prev.filter((item) => item.id !== id));
      showToast('Fiche supprimée.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Suppression impossible.');
    }
  };

  const mapsAvailable = Boolean(mapsApiKey) && !quotaExceeded;

  return (
    <div className="min-h-screen flex flex-col text-slate-900 dark:text-slate-100">
      {/* Case A: Mandatory Google Maps Demo Key Quota Banner */}
      {quotaExceeded && (
        <div className="bg-amber-50/90 backdrop-blur-md border-b border-amber-200 text-amber-900 px-4 py-2 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Strict 3-Zone Header: Brand Wordmark | 4 Single-line Nav Links | 1 Primary CTA */}
      <header className="sticky top-0 z-30 ios-glass-chrome border-b border-slate-900/[0.06] dark:border-white/[0.08]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setMainView('dashboard');
            }}
            className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
          >
            ChronoSphere
          </a>

          <nav className="hidden md:flex items-center gap-7" aria-label="Navigation principale">
            <button
              type="button"
              onClick={() => setMainView('dashboard')}
              className={`text-sm font-medium whitespace-nowrap shrink-0 transition-colors ios-press ${
                mainView === 'dashboard'
                  ? 'text-[#007AFF] dark:text-[#0A84FF]'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Tableau de bord
            </button>
            <button
              type="button"
              onClick={() => setMainView('collective')}
              className={`text-sm font-medium whitespace-nowrap shrink-0 transition-colors ios-press ${
                mainView === 'collective'
                  ? 'text-[#007AFF] dark:text-[#0A84FF]'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Collectifs
            </button>
            <button
              type="button"
              onClick={() => setMainView('map')}
              className={`text-sm font-medium whitespace-nowrap shrink-0 transition-colors ios-press ${
                mainView === 'map'
                  ? 'text-[#007AFF] dark:text-[#0A84FF]'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Carte
            </button>
            <button
              type="button"
              onClick={() => setCalendarModalOpen(true)}
              className="text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap shrink-0 transition-colors ios-press"
            >
              Calendrier
            </button>
          </nav>

          <button
            type="button"
            onClick={() => {
              setEditingEvent(null);
              setCreateModalOpen(true);
            }}
            className="ios-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Nouvel événement
          </button>
        </div>
      </header>

      {/* Frosted Workspace Toolbar (filters, search, join-by-code, PWA, theme, auth) */}
      <div className="border-b border-slate-900/[0.06] dark:border-white/[0.08] bg-white/45 dark:bg-zinc-900/40 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
            {/* iOS 17 Segmented scope filter with spring indicator */}
            <div className="ios-segmented inline-flex items-center gap-1">
              {(
                [
                  { id: 'all', label: 'Tous' },
                  { id: 'personal', label: 'Personnels' },
                  { id: 'collective', label: 'Collectifs' },
                  { id: 'archived', label: 'Archivés' },
                ] as { id: FilterMode; label: string }[]
              ).map((tab) => {
                const isActive = filterMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilterMode(tab.id)}
                    className={`relative px-3 py-1.5 rounded-[10px] text-xs font-medium transition-colors whitespace-nowrap ios-press ${
                      isActive
                        ? 'text-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="scopeFilterIndicator"
                        transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                        className="absolute inset-0 rounded-[10px] bg-white dark:bg-zinc-800 shadow-sm"
                      />
                    )}
                    <span className="relative z-10">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Search */}
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher un compte à rebours..."
                className="ios-input w-full pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            {/* Join by share code */}
            <form onSubmit={(e) => void handleJoinByCode(e)} className="flex items-center gap-1.5">
              <div className="relative">
                <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value)}
                  placeholder="Code collectif"
                  maxLength={16}
                  className="ios-input w-32 pl-8 pr-2 py-1.5 text-xs font-mono uppercase text-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                disabled={!joinCodeInput.trim()}
                className="ios-btn-secondary px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 disabled:opacity-50 whitespace-nowrap"
              >
                Rejoindre
              </button>
            </form>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => void toggleGlobalNotifications()}
              title={
                !notifSupported
                  ? 'Notifications système indisponibles (alertes internes actives)'
                  : notifPermission === 'denied'
                    ? 'Notifications bloquées dans les réglages du navigateur'
                    : notifPermission === 'default'
                      ? 'Activer les alertes navigateur à la fin des comptes à rebours'
                      : notificationsEnabled
                        ? 'Alertes navigateur actives (cliquer pour mettre en pause)'
                        : 'Alertes navigateur en pause (cliquer pour réactiver)'
              }
              className={`ios-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                notifPermission === 'granted' && notificationsEnabled
                  ? 'text-[#007AFF] dark:text-[#0A84FF]'
                  : notifPermission === 'denied'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-slate-700 dark:text-slate-200'
              }`}
            >
              {notifPermission === 'granted' && notificationsEnabled ? (
                <BellRing className="w-3.5 h-3.5 shrink-0" />
              ) : notifPermission === 'denied' || !notificationsEnabled ? (
                <BellOff className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <Bell className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>
                {!notifSupported
                  ? 'Alertes locales'
                  : notifPermission === 'denied'
                    ? 'Alertes bloquées'
                    : notifPermission === 'default'
                      ? 'Activer alertes'
                      : notificationsEnabled
                        ? 'Alertes actives'
                        : 'Alertes en pause'}
              </span>
            </button>

            {notifSupported && notifPermission === 'granted' && notificationsEnabled && (
              <button
                type="button"
                onClick={() => void testNotification()}
                title="Envoyer une notification navigateur de test"
                className="ios-btn-secondary px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap shrink-0"
              >
                Tester
              </button>
            )}

            <PWAInstallButton />

            <button
              type="button"
              onClick={handleToggleDarkMode}
              title={
                themePreference === 'system'
                  ? darkMode
                    ? 'Thème sombre (auto système) — passer au thème clair'
                    : 'Thème clair (auto système) — passer au thème sombre'
                  : darkMode
                    ? 'Thème sombre — basculer vers le thème clair'
                    : 'Thème clair — basculer vers le thème sombre'
              }
              aria-label={darkMode ? 'Activer le thème clair' : 'Activer le thème sombre'}
              className="ios-btn-secondary p-2 text-slate-600 dark:text-slate-300"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {user ? (
              <div className="ios-glass-subtle flex items-center gap-2 rounded-[14px] px-3 py-1.5">
                <span className="text-xs font-medium text-slate-800 dark:text-slate-200 max-w-[130px] truncate">
                  {currentUserName}
                </span>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  title="Déconnexion"
                  className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 ios-press"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <GoogleSignInButton
                onClick={() => void handleSignIn()}
                loading={authLoading}
                label="Connexion Google"
              />
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main id="top" className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-6 pb-24 md:pb-10 space-y-6">
        {/* Clean iOS 17 Frosted Widget Summary Metrics Strip */}
        <section
          aria-label="Synthèse"
          className="grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          <div className="ios-glass rounded-[22px] px-5 py-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Comptes à rebours actifs
              </div>
              <div className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-white mt-0.5">
                {metrics.activeCount}
              </div>
            </div>
            <Clock className="w-5 h-5 text-[#007AFF] dark:text-[#0A84FF] shrink-0" />
          </div>

          <div className="ios-glass rounded-[22px] px-5 py-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Événements collectifs
              </div>
              <div className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-white mt-0.5">
                {metrics.collectiveCount}
              </div>
            </div>
            <Users className="w-5 h-5 text-indigo-500 dark:text-indigo-400 shrink-0" />
          </div>

          <div className="ios-glass rounded-[22px] px-5 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Prochaine échéance
              </div>
              {metrics.upcoming && metrics.upcomingRem ? (
                <div className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {metrics.upcoming.title}{' '}
                  <span className="font-mono tabular-nums text-[#007AFF] dark:text-[#0A84FF]">
                    ({metrics.upcomingRem.days}j {metrics.upcomingRem.hours}h)
                  </span>
                </div>
              ) : (
                <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  Aucune échéance à venir
                </div>
              )}
            </div>
            <Calendar className="w-5 h-5 text-emerald-500 dark:text-emerald-400 shrink-0" />
          </div>
        </section>

        {!user && (
          <div className="ios-glass rounded-[20px] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
              Vous utilisez actuellement le stockage local de votre navigateur. Connectez-vous avec Google pour synchroniser vos comptes à rebours dans le cloud et collaborer en multi-utilisateurs.
            </p>
            <button
              type="button"
              onClick={() => void handleSignIn()}
              className="text-xs font-semibold text-[#007AFF] dark:text-[#0A84FF] hover:underline whitespace-nowrap ios-press"
            >
              Activer la synchronisation cloud →
            </button>
          </div>
        )}

        <AnimatePresence mode="wait">
          {mainView === 'map' ? (
            <motion.section
              key="map-view"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="ios-glass rounded-[28px] p-6 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Carte interactive des événements
                  </h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Visualisez tous vos comptes à rebours géolocalisés et accédez aux itinéraires Google Maps.
                  </p>
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {allEvents.filter((e) => typeof e.locationLat === 'number').length} lieu(x) localisé(s)
                </span>
              </div>

              <EventMapPanel
                events={allEvents}
                focusedEvent={selectedEvent}
                mapsAvailable={mapsAvailable}
                onSelectEvent={(ev) => {
                  setSelectedEventId(ev.id);
                }}
              />
            </motion.section>
          ) : (
            <motion.section
              key="workspace-view"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
            >
              {/* Left Sidebar List */}
              <div className="lg:col-span-4 space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h1 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {mainView === 'collective' ? 'Événements collectifs' : 'Vos comptes à rebours'}
                  </h1>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {filteredEvents.length}
                  </span>
                </div>

                {filteredEvents.length === 0 ? (
                  <div className="ios-glass rounded-[24px] p-8 text-center space-y-3">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Aucun compte à rebours dans cette vue
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingEvent(null);
                        setCreateModalOpen(true);
                      }}
                      className="ios-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Créer un événement
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredEvents.map((ev) => {
                      const isSelected = ev.id === selectedEvent?.id;
                      return (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => setSelectedEventId(ev.id)}
                          className={`w-full text-left rounded-[22px] p-4 space-y-3 transition-all ios-press ${
                            isSelected
                              ? 'ios-glass ring-2 ring-[#007AFF]/75 dark:ring-[#0A84FF]/80'
                              : 'ios-glass-subtle hover:bg-white/75 dark:hover:bg-white/[0.08]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 space-y-1">
                              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                {ev.scope === 'collective' ? (
                                  <Users className="w-3 h-3 text-[#007AFF] dark:text-[#0A84FF] shrink-0" />
                                ) : (
                                  <Lock className="w-3 h-3 text-slate-400 shrink-0" />
                                )}
                                <span>{ev.scope === 'collective' ? 'Collectif' : 'Personnel'}</span>
                                <span aria-hidden="true">·</span>
                                <span>{CATEGORY_LABELS[ev.category]}</span>
                              </div>
                              <h2 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                {ev.title}
                              </h2>
                            </div>
                            <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                              {formatShortDate(ev.targetIso)}
                            </span>
                          </div>

                          <CountdownClock
                            targetIso={ev.targetIso}
                            createdIso={ev.createdIso}
                            nowMs={nowMs}
                            variant="compact"
                            accentColor={ev.accentColor || '#007aff'}
                          />

                          {ev.locationName && (
                            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                              <MapPin className="w-3 h-3 shrink-0" />
                              <span className="truncate">{ev.locationName}</span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right Detail Workspace */}
              <div className="lg:col-span-8">
                {selectedEvent ? (
                  <EventDetailPanel
                    event={selectedEvent}
                    nowMs={nowMs}
                    currentUserId={currentUserId}
                    currentUserName={currentUserName}
                    isAuthenticated={Boolean(user)}
                    milestones={activeMilestones}
                    rsvps={activeRsvps}
                    messages={activeMessages}
                    savedSoundtracks={savedSoundtracks}
                    savedResearchNotes={savedResearchNotes}
                    mapsAvailable={mapsAvailable}
                    aiEnabled={aiEnabled}
                    onEdit={(ev) => {
                      setEditingEvent(ev);
                      setCreateModalOpen(true);
                    }}
                    onDelete={handleDeleteEvent}
                    onArchiveToggle={handleArchiveToggle}
                    onJoinCollective={handleJoinCollective}
                    onAddMilestone={handleAddMilestone}
                    onToggleMilestone={handleToggleMilestone}
                    onDeleteMilestone={handleDeleteMilestone}
                    onUpdateDescription={handleUpdateDescription}
                    onSubmitRsvp={handleSubmitRsvp}
                    onPostMessage={handlePostMessage}
                    onRequestCalendarExport={(ev) => setExportCandidate(ev)}
                    onSaveSoundtrack={handleSaveSoundtrack}
                    onDeleteSoundtrack={handleDeleteSoundtrack}
                    onSaveResearch={handleSaveResearch}
                    onDeleteResearch={handleDeleteResearch}
                    isNotificationMuted={isEventMuted(selectedEvent.id)}
                    onToggleNotificationMute={() =>
                      toggleEventMute(selectedEvent.id, selectedEvent.title)
                    }
                  />
                ) : (
                  <div className="ios-glass rounded-[28px] p-12 text-center space-y-3">
                    <Clock className="w-8 h-8 text-slate-400 mx-auto" />
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                      Sélectionnez ou créez un compte à rebours
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                      Suivez vos objectifs personnels ou orchestrez un événement collectif avec carte Google Maps, chronographe 3D, jalons et Google Calendar.
                    </p>
                  </div>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {/* Mobile Floating Frosted Bottom Tab Bar (<= 15% mobile viewport cap) */}
      <nav
        aria-label="Navigation mobile"
        className="md:hidden fixed bottom-3 inset-x-3 z-40 ios-glass-chrome border border-slate-900/[0.08] dark:border-white/[0.12] rounded-[22px] shadow-xl grid grid-cols-4 h-14 px-1"
      >
        {[
          { id: 'dashboard', label: 'Tableau', icon: Clock },
          { id: 'collective', label: 'Collectifs', icon: Users },
          { id: 'map', label: 'Carte', icon: MapPin },
        ].map((item) => {
          const Icon = item.icon;
          const active = mainView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setMainView(item.id as MainNavView)}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-[16px] text-[10px] font-medium ios-press ${
                active
                  ? 'text-[#007AFF] dark:text-[#0A84FF]'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setCalendarModalOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 rounded-[16px] text-[10px] font-medium text-slate-500 dark:text-slate-400 ios-press"
        >
          <Calendar className="w-4 h-4" />
          <span>Agenda</span>
        </button>
      </nav>

      {/* Modals & Status */}
      <CreateEventModal
        isOpen={createModalOpen}
        editingEvent={editingEvent}
        mapsAvailable={mapsAvailable}
        aiEnabled={aiEnabled}
        onClose={() => {
          setCreateModalOpen(false);
          setEditingEvent(null);
        }}
        onSave={handleSaveEvent}
      />

      <CalendarSyncModal
        isOpen={calendarModalOpen}
        onClose={() => setCalendarModalOpen(false)}
        onImportEvent={handleImportCalendarEvent}
      />

      <CalendarExportConfirmModal
        event={exportCandidate}
        loading={exportLoading}
        onCancel={() => setExportCandidate(null)}
        onConfirm={() => void handleConfirmCalendarExport()}
      />

      <OfflineIndicator />

      <AnimatePresence>
        {toastMsg && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-20 md:bottom-5 right-4 z-50 ios-glass-modal rounded-[18px] px-4 py-2.5 text-xs font-medium text-slate-900 dark:text-white"
          >
            {toastMsg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [aiEnabled, setAiEnabled] = useState(true);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/runtime-config');
        if (!res.ok) return;
        const data = await res.json();
        if (!mapsApiKey && typeof data.mapsApiKey === 'string' && data.mapsApiKey) {
          setMapsApiKey(data.mapsApiKey);
        }
        if (typeof data.aiEnabled === 'boolean') {
          setAiEnabled(data.aiEnabled);
        }
      } catch {
        // Fallback silently
      }
    })();
  }, [mapsApiKey]);

  if (mapsApiKey) {
    return (
      <APIProvider
        apiKey={mapsApiKey}
        libraries={['places', 'marker']}
        language="fr"
        region="FR"
      >
        <AppContent
          mapsApiKey={mapsApiKey}
          aiEnabled={aiEnabled}
          quotaExceeded={quotaExceeded}
        />
      </APIProvider>
    );
  }

  return (
    <AppContent
      mapsApiKey=""
      aiEnabled={aiEnabled}
      quotaExceeded={quotaExceeded}
    />
  );
}
