import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const eventSoundtracks = pgTable('event_soundtracks', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  eventId: text('event_id').notNull(),
  eventTitle: text('event_title').notNull(),
  model: text('model').notNull(),
  prompt: text('prompt').notNull(),
  lyrics: text('lyrics'),
  mimeType: text('mime_type').notNull(),
  audioDataUrl: text('audio_data_url').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const eventResearchNotes = pgTable('event_research_notes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  eventId: text('event_id').notNull(),
  sourceType: text('source_type').notNull(),
  query: text('query').notNull(),
  summary: text('summary').notNull(),
  linksJson: text('links_json').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const countdownAnalytics = pgTable('countdown_analytics', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  eventId: text('event_id').notNull(),
  actionType: text('action_type').notNull(),
  details: text('details').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  soundtracks: many(eventSoundtracks),
  researchNotes: many(eventResearchNotes),
  analytics: many(countdownAnalytics),
}));

export const eventSoundtracksRelations = relations(eventSoundtracks, ({ one }) => ({
  user: one(users, {
    fields: [eventSoundtracks.userId],
    references: [users.id],
  }),
}));

export const eventResearchNotesRelations = relations(eventResearchNotes, ({ one }) => ({
  user: one(users, {
    fields: [eventResearchNotes.userId],
    references: [users.id],
  }),
}));

export const countdownAnalyticsRelations = relations(countdownAnalytics, ({ one }) => ({
  user: one(users, {
    fields: [countdownAnalytics.userId],
    references: [users.id],
  }),
}));
