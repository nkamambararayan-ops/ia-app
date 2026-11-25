import { CountdownEvent, TimeRemaining } from '../types';

export function getTimeRemaining(
  targetIso: string,
  createdIso?: string,
  nowMs: number = Date.now()
): TimeRemaining {
  const targetMs = new Date(targetIso).getTime();
  if (Number.isNaN(targetMs)) {
    return {
      totalMs: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      isExpired: true,
      progressPercent: 100,
    };
  }

  const diff = targetMs - nowMs;
  const isExpired = diff <= 0;
  const absDiff = Math.max(0, diff);

  const days = Math.floor(absDiff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((absDiff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((absDiff / (1000 * 60)) % 60);
  const seconds = Math.floor((absDiff / 1000) % 60);

  let progressPercent = 100;
  if (!isExpired && createdIso) {
    const startMs = new Date(createdIso).getTime();
    if (!Number.isNaN(startMs) && targetMs > startMs) {
      const elapsed = Math.max(0, nowMs - startMs);
      const totalSpan = targetMs - startMs;
      progressPercent = Math.min(99.5, Math.max(2, (elapsed / totalSpan) * 100));
    } else {
      progressPercent = 25;
    }
  } else if (!isExpired) {
    progressPercent = 25;
  }

  return {
    totalMs: diff,
    days,
    hours,
    minutes,
    seconds,
    isExpired,
    progressPercent,
  };
}

export function formatFrenchDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date invalide';
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

export function toLocalDateTimeInputValue(iso?: string): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

export function generateSafeId(prefix = 'evt'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '');
}

export function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function downloadIcsFile(event: CountdownEvent): void {
  const start = new Date(event.targetIso);
  if (Number.isNaN(start.getTime())) return;
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const fmt = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');

  const escapeIcs = (str: string) =>
    str.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ChronoSphere//FR',
    'BEGIN:VEVENT',
    `UID:${event.id}@chronosphere`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    event.description ? `DESCRIPTION:${escapeIcs(event.description)}` : '',
    event.locationAddress || event.locationName
      ? `LOCATION:${escapeIcs(event.locationAddress || event.locationName || '')}`
      : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');

  const blob = new Blob([lines], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'evenement'}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
