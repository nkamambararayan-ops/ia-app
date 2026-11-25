import { CountdownEvent, GoogleCalendarEventItem } from '../types';

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export async function listUpcomingCalendarEvents(
  accessToken: string,
  maxResults = 15
): Promise<GoogleCalendarEventItem[]> {
  const params = new URLSearchParams({
    timeMin: new Date().toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(maxResults),
  });

  const res = await fetch(`${CALENDAR_BASE}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar API (${res.status}): ${text}`);
  }

  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  countdown: CountdownEvent
): Promise<GoogleCalendarEventItem> {
  const startDate = new Date(countdown.targetIso);
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

  const payload = {
    summary: countdown.title,
    description: countdown.description || `Compte à rebours ChronoSphere (${countdown.scope})`,
    location: countdown.locationAddress || countdown.locationName || undefined,
    start: {
      dateTime: startDate.toISOString(),
    },
    end: {
      dateTime: endDate.toISOString(),
    },
  };

  const res = await fetch(CALENDAR_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Impossible d'ajouter à Google Calendar (${res.status}): ${text}`);
  }

  return res.json();
}
