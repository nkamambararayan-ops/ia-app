export type CountdownScope = 'personal' | 'collective';
export type CountdownCategory = 'celebration' | 'voyage' | 'launch' | 'focus' | 'other';
export type CoverKey = 'celebration' | 'voyage' | 'launch' | 'focus';
export type CountdownStatus = 'active' | 'archived';
export type RsvpStatus = 'going' | 'maybe' | 'declined';

export interface CountdownEvent {
  id: string;
  ownerId: string;
  ownerName: string;
  title: string;
  description?: string;
  targetIso: string;
  createdIso: string;
  scope: CountdownScope;
  category: CountdownCategory;
  accentColor?: string;
  coverKey: CoverKey;
  shareCode: string;
  participantIds: string[];
  locationName?: string;
  locationAddress?: string;
  locationLat?: number;
  locationLng?: number;
  placeId?: string;
  calendarEventId?: string;
  status: CountdownStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
  isLocalOnly?: boolean;
}

export interface Milestone {
  id: string;
  title: string;
  dueIso?: string;
  completed: boolean;
  createdBy: string;
  createdAt?: unknown;
}

export interface RsvpEntry {
  uid: string;
  displayName: string;
  status: RsvpStatus;
  note?: string;
  updatedAt?: unknown;
}

export interface GuestMessage {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  reaction?: string;
  createdAt?: unknown;
}

export interface ParticipantLocation {
  uid: string;
  displayName: string;
  lat: number;
  lng: number;
  accuracy?: number;
  updatedAt?: unknown;
  updatedAtMs?: number;
}

export interface TimeRemaining {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
  progressPercent: number;
}

export interface GoogleCalendarEventItem {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
}

export interface GroundingLink {
  title: string;
  uri: string;
}

export interface ReviewSnippet {
  title: string;
  snippet: string;
  uri?: string;
}

export interface SavedSoundtrack {
  id: number;
  eventId: string;
  eventTitle: string;
  model: string;
  prompt: string;
  lyrics?: string | null;
  mimeType: string;
  audioDataUrl: string;
  createdAt: string;
}

export interface SavedResearchNote {
  id: number;
  eventId: string;
  sourceType: 'maps_grounding' | 'search_grounding' | 'live_voice';
  query: string;
  summary: string;
  linksJson: string;
  createdAt: string;
}

export interface ActivityLogEntry {
  id: number;
  eventId: string;
  actionType: string;
  details: string;
  createdAt: string;
}

export const FIELD_LIMITS = {
  idMax: 128,
  ownerNameMax: 80,
  titleMax: 120,
  descriptionMax: 1200,
  milestoneTitleMax: 140,
  messageTextMax: 500,
  rsvpNoteMax: 200,
  locationNameMax: 160,
  locationAddressMax: 240,
  maxParticipants: 50,
} as const;

export const COVER_IMAGES: Record<CoverKey, string> = {
  celebration: '/src/assets/images/cover_celebration_1795563273191.jpg',
  voyage: '/src/assets/images/cover_voyage_1795563273598.jpg',
  launch: '/src/assets/images/cover_launch_1795563274232.jpg',
  focus: '/src/assets/images/cover_focus_1795563275000.jpg',
};

export const CATEGORY_LABELS: Record<CountdownCategory, string> = {
  celebration: 'Célébration',
  voyage: 'Voyage',
  launch: 'Lancement',
  focus: 'Objectif',
  other: 'Événement',
};

export const COVER_LABELS: Record<CoverKey, string> = {
  celebration: 'Soirée & Gala',
  voyage: 'Horizon & Voyage',
  launch: 'Studio & Lancement',
  focus: 'Sommet & Défi',
};

export const ACCENT_COLORS = [
  { id: '#d97706', label: 'Ambre' },
  { id: '#0284c7', label: 'Azur' },
  { id: '#059669', label: 'Émeraude' },
  { id: '#e11d48', label: 'Carmin' },
  { id: '#4f46e5', label: 'Indigo' },
];
