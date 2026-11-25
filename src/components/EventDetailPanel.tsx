import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Archive,
  Bell,
  BellOff,
  Box,
  CalendarPlus,
  Check,
  CheckSquare,
  Copy,
  Download,
  Edit3,
  Loader2,
  MapPin,
  MessageSquare,
  Plus,
  Send,
  Share2,
  Sparkles,
  Square,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  CATEGORY_LABELS,
  CountdownEvent,
  COVER_IMAGES,
  FIELD_LIMITS,
  GroundingLink,
  GuestMessage,
  Milestone,
  RsvpEntry,
  RsvpStatus,
  SavedResearchNote,
  SavedSoundtrack,
} from '../types';
import { downloadIcsFile, formatFrenchDateTime } from '../lib/time';
import { CountdownClock } from './CountdownClock';
import { ChronoScene3D } from './ChronoScene3D';
import { EventMapPanel } from './EventMapPanel';
import { EventIntelligencePanel, MapsGroundingPanel } from './EventIntelligencePanel';
import { LiveVoicePanel } from './LiveVoicePanel';
import { useRealtimeRoom } from '../hooks/useRealtimeRoom';

type DetailTab = 'overview' | 'milestones' | 'collective' | 'map' | 'studio' | 'voice';

interface EventDetailPanelProps {
  event: CountdownEvent;
  nowMs: number;
  currentUserId: string;
  currentUserName: string;
  isAuthenticated: boolean;
  milestones: Milestone[];
  rsvps: RsvpEntry[];
  messages: GuestMessage[];
  savedSoundtracks: SavedSoundtrack[];
  savedResearchNotes: SavedResearchNote[];
  mapsAvailable: boolean;
  aiEnabled: boolean;
  onEdit: (event: CountdownEvent) => void;
  onDelete: (event: CountdownEvent) => Promise<void>;
  onArchiveToggle: (event: CountdownEvent) => Promise<void>;
  onJoinCollective: (event: CountdownEvent) => Promise<void>;
  onAddMilestone: (title: string, dueIso?: string) => Promise<void>;
  onToggleMilestone: (milestone: Milestone) => Promise<void>;
  onDeleteMilestone: (milestoneId: string) => Promise<void>;
  onUpdateDescription: (description: string) => Promise<void>;
  onSubmitRsvp: (status: RsvpStatus, note: string) => Promise<void>;
  onPostMessage: (text: string, reaction?: string) => Promise<void>;
  onRequestCalendarExport: (event: CountdownEvent) => void;
  onSaveSoundtrack: (payload: {
    model: string;
    prompt: string;
    lyrics?: string;
    mimeType: string;
    audioDataUrl: string;
  }) => Promise<void>;
  onDeleteSoundtrack: (id: number) => Promise<void>;
  onSaveResearch: (payload: {
    sourceType: 'maps_grounding' | 'search_grounding' | 'live_voice';
    query: string;
    summary: string;
    links: GroundingLink[];
  }) => Promise<void>;
  onDeleteResearch: (id: number) => Promise<void>;
  isNotificationMuted?: boolean;
  onToggleNotificationMute?: () => void;
}

export const EventDetailPanel: React.FC<EventDetailPanelProps> = ({
  event,
  nowMs,
  currentUserId,
  currentUserName,
  isAuthenticated,
  milestones,
  rsvps,
  messages,
  savedSoundtracks,
  savedResearchNotes,
  mapsAvailable,
  aiEnabled,
  onEdit,
  onDelete,
  onArchiveToggle,
  onJoinCollective,
  onAddMilestone,
  onToggleMilestone,
  onDeleteMilestone,
  onUpdateDescription,
  onSubmitRsvp,
  onPostMessage,
  onRequestCalendarExport,
  onSaveSoundtrack,
  onDeleteSoundtrack,
  onSaveResearch,
  onDeleteResearch,
  isNotificationMuted = false,
  onToggleNotificationMute,
}) => {
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [show3D, setShow3D] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Milestones & AI Planning state
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [aiPlanning, setAiPlanning] = useState(false);
  const [aiInviteText, setAiInviteText] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Collective RSVP & guestbook state
  const [rsvpNote, setRsvpNote] = useState('');
  const [messageText, setMessageText] = useState('');
  const [postingMsg, setPostingMsg] = useState(false);

  const isOwner = event.ownerId === currentUserId || Boolean(event.isLocalOnly);
  const isParticipant = event.participantIds.includes(currentUserId);

  const {
    participants: onlinePeers,
    connected: wsConnected,
    reactions,
    lastActivity,
    sendReaction,
    notifyActivity,
  } = useRealtimeRoom(
    event.scope === 'collective' ? event.id : null,
    currentUserName,
    currentUserId
  );

  const handleCopyShare = async () => {
    const url = `${window.location.origin}/?event=${encodeURIComponent(event.id)}&code=${encodeURIComponent(event.shareCode)}`;
    await navigator.clipboard.writeText(url);
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleAiPlan = async () => {
    setAiPlanning(true);
    setAiError(null);
    try {
      const res = await fetch('/api/ai/plan-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: event.title,
          scope: event.scope,
          category: event.category,
          targetIso: event.targetIso,
          locationName: event.locationName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Génération impossible');

      if (data.description && isOwner) {
        await onUpdateDescription(String(data.description).slice(0, FIELD_LIMITS.descriptionMax));
      }
      if (data.invitationMessage) {
        setAiInviteText(String(data.invitationMessage));
      }
      if (Array.isArray(data.milestones)) {
        const targetMs = new Date(event.targetIso).getTime();
        for (const item of data.milestones.slice(0, 6)) {
          if (item?.title) {
            const daysBefore = Number(item.daysBefore) || 0;
            const dueMs = Math.max(Date.now(), targetMs - daysBefore * 86400000);
            await onAddMilestone(
              String(item.title).slice(0, FIELD_LIMITS.milestoneTitleMax),
              new Date(dueMs).toISOString()
            );
          }
        }
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Erreur assistant IA');
    } finally {
      setAiPlanning(false);
    }
  };

  const handleCreateMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMilestoneTitle.trim()) return;
    await onAddMilestone(newMilestoneTitle.trim().slice(0, FIELD_LIMITS.milestoneTitleMax));
    setNewMilestoneTitle('');
    notifyActivity('milestone');
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim()) return;
    setPostingMsg(true);
    try {
      await onPostMessage(messageText.trim().slice(0, FIELD_LIMITS.messageTextMax));
      setMessageText('');
      notifyActivity('message');
    } finally {
      setPostingMsg(false);
    }
  };

  const completedCount = milestones.filter((m) => m.completed).length;

  return (
    <motion.div
      key={event.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="ios-glass rounded-[28px] overflow-hidden"
    >
      {/* Cover Hero with measured contrast scrim */}
      <div className="relative h-56 sm:h-64 w-full bg-slate-900 overflow-hidden">
        <img
          src={COVER_IMAGES[event.coverKey] || COVER_IMAGES.celebration}
          alt={event.title}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/45 to-slate-950/15" />

        <div className="absolute inset-x-0 bottom-0 p-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            {/* Zero-pill metadata line with clean typographic separators */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-200">
              <span>{event.scope === 'collective' ? 'Événement collectif' : 'Personnel'}</span>
              <span aria-hidden="true">·</span>
              <span>{CATEGORY_LABELS[event.category]}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{formatFrenchDateTime(event.targetIso)}</span>
              {event.locationName && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate max-w-[200px]">{event.locationName}</span>
                </>
              )}
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight text-balance">
              {event.title}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShow3D((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-[14px] px-3.5 py-2 text-xs font-medium transition-all whitespace-nowrap ios-press ${
                show3D
                  ? 'bg-[#007AFF] text-white shadow-md'
                  : 'bg-white/18 backdrop-blur-md text-white hover:bg-white/28 border border-white/25'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              {show3D ? 'Vue classique' : 'Chronographe 3D'}
            </button>

            {event.scope === 'collective' && (
              <button
                type="button"
                onClick={() => void handleCopyShare()}
                className="inline-flex items-center gap-1.5 rounded-[14px] bg-white/18 backdrop-blur-md hover:bg-white/28 border border-white/25 px-3.5 py-2 text-xs font-medium text-white transition-all whitespace-nowrap ios-press"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                {copiedLink ? 'Lien copié' : 'Partager'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Segmented Workspace Sub-Nav */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 border-b border-slate-900/[0.06] dark:border-white/[0.08] bg-white/35 dark:bg-white/[0.02] backdrop-blur-xl">
        <div className="ios-segmented flex items-center gap-1 overflow-x-auto">
          {[
            { id: 'overview', label: 'Aperçu & Chrono' },
            { id: 'milestones', label: `Jalons (${completedCount}/${milestones.length})` },
            { id: 'collective', label: event.scope === 'collective' ? `Collectif (${rsvps.length})` : 'Partage' },
            { id: 'map', label: 'Lieu & Carte' },
            { id: 'studio', label: 'Recherche & Musique' },
            { id: 'voice', label: 'Assistant Vocal' },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as DetailTab)}
                className={`relative px-3 py-1.5 text-xs font-medium rounded-[10px] transition-colors whitespace-nowrap shrink-0 ios-press ${
                  isActive
                    ? 'text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="detailTabIndicator"
                    transition={{ type: 'spring', stiffness: 460, damping: 36 }}
                    className="absolute inset-0 rounded-[10px] bg-white dark:bg-zinc-800 shadow-sm"
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onToggleNotificationMute && (
            <button
              type="button"
              onClick={onToggleNotificationMute}
              title={
                isNotificationMuted
                  ? "Activer l'alerte de fin pour cet événement"
                  : "Couper l'alerte de fin pour cet événement"
              }
              aria-label={
                isNotificationMuted
                  ? "Activer l'alerte de fin pour cet événement"
                  : "Couper l'alerte de fin pour cet événement"
              }
              className={`ios-btn-secondary p-2 ${
                isNotificationMuted
                  ? 'text-slate-400 dark:text-slate-500'
                  : 'text-[#007AFF] dark:text-[#0A84FF]'
              }`}
            >
              {isNotificationMuted ? (
                <BellOff className="w-3.5 h-3.5" />
              ) : (
                <Bell className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => downloadIcsFile(event)}
            className="ios-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            .ICS
          </button>

          <button
            type="button"
            onClick={() => onRequestCalendarExport(event)}
            className="ios-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap"
          >
            <CalendarPlus className="w-3.5 h-3.5" />
            Google Agenda
          </button>

          {isOwner && (
            <>
              <button
                type="button"
                onClick={() => onEdit(event)}
                title="Modifier"
                className="ios-btn-secondary p-2 text-slate-600 dark:text-slate-300"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void onArchiveToggle(event)}
                title={event.status === 'archived' ? 'Réactiver' : 'Archiver'}
                className="ios-btn-secondary p-2 text-slate-600 dark:text-slate-300"
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void onDelete(event)}
                title="Supprimer"
                className="ios-btn-secondary p-2 text-rose-600 dark:text-rose-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-6"
          >
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <CountdownClock
              targetIso={event.targetIso}
              createdIso={event.createdIso}
              nowMs={nowMs}
              variant="hero"
              accentColor={event.accentColor || '#d97706'}
            />

            {show3D && (
              <ChronoScene3D
                title={event.title}
                targetIso={event.targetIso}
                createdIso={event.createdIso}
                accentColor={event.accentColor || '#d97706'}
              />
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-3 border-t border-slate-900/[0.06] dark:border-white/[0.08]">
              <div className="md:col-span-2 space-y-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  À propos de l'événement
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {event.description ||
                    "Aucune description pour le moment. Utilisez l'assistant IA dans l'onglet Jalons pour générer un programme et une présentation sur mesure."}
                </p>
              </div>

              <div className="space-y-3 text-sm border-t md:border-t-0 md:border-l border-slate-900/[0.06] dark:border-white/[0.08] pt-4 md:pt-0 md:pl-6">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Organisateur</div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {event.ownerName}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Code d'invitation</div>
                  <div className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <span>{event.shareCode}</span>
                    <button
                      type="button"
                      onClick={() => void handleCopyShare()}
                      className="text-xs text-[#007AFF] dark:text-[#0A84FF] hover:underline inline-flex items-center gap-1 ios-press"
                    >
                      <Copy className="w-3 h-3" />
                      Copier
                    </button>
                  </div>
                </div>
                {event.locationAddress && (
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Lieu</div>
                    <div className="text-slate-800 dark:text-slate-200 flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[#007AFF] dark:text-[#0A84FF] shrink-0 mt-0.5" />
                      <span>{event.locationAddress}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'milestones' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Jalons & préparation
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Suivez les étapes clés avant l'échéance finale.
                </p>
              </div>

              {aiEnabled && (
                <button
                  type="button"
                  onClick={() => void handleAiPlan()}
                  disabled={aiPlanning}
                  className="ios-btn-primary inline-flex items-center gap-2 px-3.5 py-2 text-xs disabled:opacity-50 whitespace-nowrap"
                >
                  {aiPlanning ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  Planifier avec l'IA
                </button>
              )}
            </div>

            {aiError && (
              <div className="rounded-[14px] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {aiError}
              </div>
            )}

            {aiInviteText && (
              <div className="rounded-[20px] border border-[#007AFF]/25 bg-[#007AFF]/[0.07] dark:bg-[#0A84FF]/15 backdrop-blur-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#007AFF] dark:text-[#0A84FF]">
                    Message d'invitation suggéré par l'IA
                  </span>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(aiInviteText)}
                    className="text-xs font-medium text-[#007AFF] dark:text-[#0A84FF] hover:underline inline-flex items-center gap-1 ios-press"
                  >
                    <Copy className="w-3 h-3" />
                    Copier le texte
                  </button>
                </div>
                <p className="text-sm text-slate-800 dark:text-slate-200">{aiInviteText}</p>
              </div>
            )}

            {(isOwner || (event.scope === 'collective' && isParticipant)) && (
              <form onSubmit={(e) => void handleCreateMilestone(e)} className="flex gap-2">
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.milestoneTitleMax}
                  value={newMilestoneTitle}
                  onChange={(e) => setNewMilestoneTitle(e.target.value)}
                  placeholder="Ajouter une étape ou tâche de préparation..."
                  className="ios-input flex-1 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={!newMilestoneTitle.trim()}
                  className="ios-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs disabled:opacity-50 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Ajouter
                </button>
              </form>
            )}

            {milestones.length === 0 ? (
              <div className="ios-glass-subtle rounded-[20px] p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Aucun jalon enregistré. Ajoutez une étape ou laissez l'IA proposer une checklist.
              </div>
            ) : (
              <div className="ios-glass-subtle divide-y divide-slate-900/[0.06] dark:divide-white/[0.08] rounded-[20px] overflow-hidden">
                {milestones.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void onToggleMilestone(m)}
                      className="flex items-center gap-3 text-left min-w-0 flex-1"
                    >
                      {m.completed ? (
                        <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <span
                        className={`text-sm truncate ${
                          m.completed
                            ? 'line-through text-slate-400 dark:text-slate-500'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {m.title}
                      </span>
                    </button>

                    <div className="flex items-center gap-3 shrink-0">
                      {m.dueIso && (
                        <span className="text-xs font-mono tabular-nums text-slate-400 hidden sm:inline">
                          {new Date(m.dueIso).toLocaleDateString('fr-FR')}
                        </span>
                      )}
                      {(isOwner || m.createdBy === currentUserId) && (
                        <button
                          type="button"
                          onClick={() => void onDeleteMilestone(m.id)}
                          aria-label="Supprimer le jalon"
                          className="p-1 text-slate-400 hover:text-rose-600"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'collective' && (
          <div className="space-y-6">
            {event.scope === 'personal' ? (
              <div className="ios-glass-subtle rounded-[20px] p-6 text-center space-y-2">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Ce compte à rebours est actuellement personnel (privé).
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Modifiez l'événement et passez sa portée sur « Collectif » pour activer les invitations, RSVP et le chat en direct.
                </p>
              </div>
            ) : (
              <>
                {/* Real-time WebSocket Presence & Live Reactions Bar */}
                <div className="ios-glass-subtle rounded-[20px] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <Users className="w-4 h-4 text-[#007AFF] dark:text-[#0A84FF]" />
                      <span className="font-mono tabular-nums font-semibold">
                        {onlinePeers.length}
                      </span>
                      <span>
                        {onlinePeers.length > 1 ? 'connectés en direct' : 'connecté en direct'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{wsConnected ? 'Temps réel actif' : 'Reconnexion...'}</span>
                    </div>

                    {!isParticipant && isAuthenticated && (
                      <button
                        type="button"
                        onClick={() => void onJoinCollective(event)}
                        className="ios-btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs whitespace-nowrap"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        Rejoindre cet événement
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">
                      Réagir en direct :
                    </span>
                    {['🎉', '🔥', '👏', '✨', '❤️', '🚀'].map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => sendReaction(emoji)}
                        className="ios-btn-secondary px-2.5 py-1 text-sm hover:scale-105"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>

                  {reactions.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1 text-xs text-slate-600 dark:text-slate-300">
                      {reactions.map((r) => (
                        <span
                          key={r.id}
                          className="inline-flex items-center gap-1 text-xs font-medium"
                        >
                          <span>{r.emoji}</span>
                          <span>{r.displayName}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  {lastActivity && (
                    <div className="text-xs text-[#007AFF] dark:text-[#0A84FF]">
                      {lastActivity}
                    </div>
                  )}
                </div>

                {/* RSVP Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Votre participation (RSVP)
                    </h3>
                    <input
                      type="text"
                      maxLength={FIELD_LIMITS.rsvpNoteMax}
                      value={rsvpNote}
                      onChange={(e) => setRsvpNote(e.target.value)}
                      placeholder="Note optionnelle (ex : J'apporte le dessert)..."
                      className="ios-input w-full px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100"
                    />
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { id: 'going', label: 'Je participe' },
                          { id: 'maybe', label: 'Peut-être' },
                          { id: 'declined', label: 'Absent' },
                        ] as { id: RsvpStatus; label: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={async () => {
                            await onSubmitRsvp(opt.id, rsvpNote.trim());
                            notifyActivity('rsvp');
                          }}
                          className="ios-btn-secondary px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <div className="ios-glass-subtle divide-y divide-slate-900/[0.06] dark:divide-white/[0.08] rounded-[18px] mt-3 overflow-hidden">
                      {rsvps.length === 0 ? (
                        <div className="p-4 text-xs text-slate-500 dark:text-slate-400">
                          Aucune réponse enregistrée pour le moment.
                        </div>
                      ) : (
                        rsvps.map((r) => (
                          <div key={r.uid} className="px-4 py-2.5 flex items-center justify-between gap-2 text-sm">
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                                {r.displayName}
                              </div>
                              {r.note && (
                                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                  {r.note}
                                </div>
                              )}
                            </div>
                            <span
                              className={`text-xs font-medium whitespace-nowrap ${
                                r.status === 'going'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : r.status === 'maybe'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-slate-400'
                              }`}
                            >
                              {r.status === 'going'
                                ? 'Participe'
                                : r.status === 'maybe'
                                ? 'Peut-être'
                                : 'Absent'}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Guestbook Wall */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-slate-500" />
                      Mur des participants
                    </h3>

                    <form onSubmit={(e) => void handleSendMessage(e)} className="flex gap-2">
                      <input
                        type="text"
                        maxLength={FIELD_LIMITS.messageTextMax}
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        placeholder="Écrire un message au groupe..."
                        className="ios-input flex-1 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="submit"
                        disabled={postingMsg || !messageText.trim()}
                        className="ios-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs disabled:opacity-50 whitespace-nowrap"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Envoyer
                      </button>
                    </form>

                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {messages.length === 0 ? (
                        <div className="ios-glass-subtle rounded-[18px] p-4 text-xs text-slate-500 dark:text-slate-400">
                          Aucun message pour l'instant. Lancez la discussion !
                        </div>
                      ) : (
                        messages.map((msg) => (
                          <div
                            key={msg.id}
                            className="ios-glass-subtle rounded-[16px] px-3.5 py-2.5 space-y-1"
                          >
                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                              {msg.authorName}
                            </div>
                            <p className="text-sm text-slate-900 dark:text-slate-100">{msg.text}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'map' && (
          <div className="space-y-6">
            <EventMapPanel
              events={[event]}
              focusedEvent={event}
              mapsAvailable={mapsAvailable}
            />
            {aiEnabled && (
              <MapsGroundingPanel
                event={event}
                isAuthenticated={isAuthenticated}
                onSaveResearch={async (payload) => {
                  await onSaveResearch(payload);
                }}
              />
            )}
          </div>
        )}

        {activeTab === 'studio' && (
          <EventIntelligencePanel
            event={event}
            isAuthenticated={isAuthenticated}
            savedSoundtracks={savedSoundtracks}
            savedResearchNotes={savedResearchNotes}
            onSaveSoundtrack={onSaveSoundtrack}
            onDeleteSoundtrack={onDeleteSoundtrack}
            onSaveResearch={onSaveResearch}
            onDeleteResearch={onDeleteResearch}
          />
        )}

        {activeTab === 'voice' && (
          <LiveVoicePanel
            event={event}
            isAuthenticated={isAuthenticated}
            onSaveTranscriptSummary={async (summary) => {
              await onSaveResearch({
                sourceType: 'live_voice',
                query: `Échange vocal — ${event.title}`,
                summary,
                links: [],
              });
            }}
          />
        )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
