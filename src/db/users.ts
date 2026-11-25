import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  countdownAnalytics,
  eventResearchNotes,
  eventSoundtracks,
  users,
} from './schema.ts';

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string
) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email: email || 'utilisateur@chronosphere.app',
        displayName: displayName || null,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: email || 'utilisateur@chronosphere.app',
          displayName: displayName || null,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Impossible de synchroniser le profil utilisateur.', {
      cause: error,
    });
  }
}

export async function getUserEventSqlWorkspace(userId: number, eventId?: string) {
  try {
    const soundtracksQuery = eventId
      ? db
          .select()
          .from(eventSoundtracks)
          .where(
            and(
              eq(eventSoundtracks.userId, userId),
              eq(eventSoundtracks.eventId, eventId)
            )
          )
          .orderBy(desc(eventSoundtracks.createdAt))
          .limit(20)
      : db
          .select()
          .from(eventSoundtracks)
          .where(eq(eventSoundtracks.userId, userId))
          .orderBy(desc(eventSoundtracks.createdAt))
          .limit(20);

    const researchQuery = eventId
      ? db
          .select()
          .from(eventResearchNotes)
          .where(
            and(
              eq(eventResearchNotes.userId, userId),
              eq(eventResearchNotes.eventId, eventId)
            )
          )
          .orderBy(desc(eventResearchNotes.createdAt))
          .limit(20)
      : db
          .select()
          .from(eventResearchNotes)
          .where(eq(eventResearchNotes.userId, userId))
          .orderBy(desc(eventResearchNotes.createdAt))
          .limit(20);

    const analyticsQuery = eventId
      ? db
          .select()
          .from(countdownAnalytics)
          .where(
            and(
              eq(countdownAnalytics.userId, userId),
              eq(countdownAnalytics.eventId, eventId)
            )
          )
          .orderBy(desc(countdownAnalytics.createdAt))
          .limit(30)
      : db
          .select()
          .from(countdownAnalytics)
          .where(eq(countdownAnalytics.userId, userId))
          .orderBy(desc(countdownAnalytics.createdAt))
          .limit(30);

    const [soundtracks, researchNotes, activityLog] = await Promise.all([
      soundtracksQuery,
      researchQuery,
      analyticsQuery,
    ]);

    return { soundtracks, researchNotes, activityLog };
  } catch (error) {
    console.error('Database workspace query failed:', error);
    throw new Error('Lecture des archives SQL impossible pour le moment.', {
      cause: error,
    });
  }
}

export async function saveSqlSoundtrack(input: {
  userId: number;
  eventId: string;
  eventTitle: string;
  model: string;
  prompt: string;
  lyrics?: string;
  mimeType: string;
  audioDataUrl: string;
}) {
  try {
    const inserted = await db
      .insert(eventSoundtracks)
      .values({
        userId: input.userId,
        eventId: input.eventId,
        eventTitle: input.eventTitle,
        model: input.model,
        prompt: input.prompt,
        lyrics: input.lyrics || null,
        mimeType: input.mimeType,
        audioDataUrl: input.audioDataUrl,
      })
      .returning();

    await db.insert(countdownAnalytics).values({
      userId: input.userId,
      eventId: input.eventId,
      actionType: 'music_generated',
      details: `Bande sonore (${input.model}) : ${input.prompt.slice(0, 120)}`,
    });

    return inserted[0];
  } catch (error) {
    console.error('Database soundtrack save failed:', error);
    throw new Error('Impossible d\'enregistrer la bande sonore.', {
      cause: error,
    });
  }
}

export async function deleteSqlSoundtrack(userId: number, soundtrackId: number) {
  try {
    const deleted = await db
      .delete(eventSoundtracks)
      .where(
        and(
          eq(eventSoundtracks.id, soundtrackId),
          eq(eventSoundtracks.userId, userId)
        )
      )
      .returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database soundtrack delete failed:', error);
    throw new Error('Impossible de supprimer la bande sonore.', {
      cause: error,
    });
  }
}

export async function saveSqlResearchNote(input: {
  userId: number;
  eventId: string;
  sourceType: 'maps_grounding' | 'search_grounding' | 'live_voice';
  query: string;
  summary: string;
  links: Array<{ title: string; uri: string }>;
}) {
  try {
    const inserted = await db
      .insert(eventResearchNotes)
      .values({
        userId: input.userId,
        eventId: input.eventId,
        sourceType: input.sourceType,
        query: input.query,
        summary: input.summary,
        linksJson: JSON.stringify(input.links),
      })
      .returning();

    await db.insert(countdownAnalytics).values({
      userId: input.userId,
      eventId: input.eventId,
      actionType: 'research_saved',
      details: `${input.sourceType} : ${input.query.slice(0, 120)}`,
    });

    return inserted[0];
  } catch (error) {
    console.error('Database research note save failed:', error);
    throw new Error('Impossible d\'enregistrer la note de recherche.', {
      cause: error,
    });
  }
}

export async function deleteSqlResearchNote(userId: number, noteId: number) {
  try {
    const deleted = await db
      .delete(eventResearchNotes)
      .where(
        and(
          eq(eventResearchNotes.id, noteId),
          eq(eventResearchNotes.userId, userId)
        )
      )
      .returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database research note delete failed:', error);
    throw new Error('Impossible de supprimer la note.', { cause: error });
  }
}

export async function logSqlActivity(input: {
  userId: number;
  eventId: string;
  actionType: string;
  details: string;
}) {
  try {
    const inserted = await db
      .insert(countdownAnalytics)
      .values({
        userId: input.userId,
        eventId: input.eventId,
        actionType: input.actionType,
        details: input.details.slice(0, 300),
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database activity log failed:', error);
    throw new Error('Impossible d\'enregistrer l\'activité.', { cause: error });
  }
}
