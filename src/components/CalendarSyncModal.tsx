import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Calendar, CheckCircle2, Loader2, LogOut, Plus, RefreshCw, X } from 'lucide-react';
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getCalendarAccessToken,
} from '../lib/firebase';
import { listUpcomingCalendarEvents } from '../lib/calendarApi';
import { CountdownEvent, GoogleCalendarEventItem } from '../types';
import { formatFrenchDateTime } from '../lib/time';

interface CalendarSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportEvent: (item: GoogleCalendarEventItem) => Promise<void>;
}

export const GoogleSignInButton: React.FC<{
  onClick: () => void;
  loading?: boolean;
  label?: string;
}> = ({ onClick, loading, label = 'Sign in with Google' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={loading}
    className="ios-btn-secondary inline-flex items-center gap-2.5 px-4 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 disabled:opacity-60 whitespace-nowrap shrink-0"
  >
    <svg viewBox="0 0 48 48" className="w-4 h-4 shrink-0" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
    <span>{loading ? 'Connexion...' : label}</span>
  </button>
);

export const CalendarSyncModal: React.FC<CalendarSyncModalProps> = ({
  isOpen,
  onClose,
  onImportEvent,
}) => {
  const [token, setToken] = useState<string | null>(getCalendarAccessToken());
  const [events, setEvents] = useState<GoogleCalendarEventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async (accessToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const items = await listUpcomingCalendarEvents(accessToken, 15);
      setEvents(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de lecture Google Calendar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      const existing = getCalendarAccessToken();
      setToken(existing);
      if (existing) {
        void loadEvents(existing);
      }
    }
  }, [isOpen, loadEvents]);

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await connectGoogleCalendar();
      setToken(res.accessToken);
      await loadEvents(res.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion Google Calendar annulée');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnectGoogleCalendar();
    setToken(null);
    setEvents([]);
  };

  const handleImport = async (item: GoogleCalendarEventItem) => {
    setImportingId(item.id);
    try {
      await onImportEvent(item);
      setImportedIds((prev) => ({ ...prev, [item.id]: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import impossible');
    } finally {
      setImportingId(null);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/45 backdrop-blur-md p-0 sm:p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="ios-glass-modal w-full max-w-2xl rounded-t-[28px] sm:rounded-[28px] overflow-hidden"
          >
            <div className="pt-2.5 sm:hidden">
              <div className="w-10 h-1 rounded-full bg-slate-400/40 mx-auto" />
            </div>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-900/[0.06] dark:border-white/[0.08]">
              <div className="flex items-center gap-2.5">
                <Calendar className="w-5 h-5 text-[#007AFF] dark:text-[#0A84FF]" />
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Synchronisation Google Calendar
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="p-2 rounded-full text-slate-500 hover:bg-slate-900/5 dark:hover:bg-white/10 ios-press"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {!token ? (
                <div className="ios-glass-subtle rounded-[20px] p-6 text-center space-y-4">
                  <Calendar className="w-8 h-8 text-[#007AFF] dark:text-[#0A84FF] mx-auto" />
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      Connectez votre Google Calendar
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                      Importez vos prochains rendez-vous en un clic comme comptes à rebours ou exportez vos événements ChronoSphere vers votre calendrier principal.
                    </p>
                  </div>
                  <div className="flex justify-center">
                    <GoogleSignInButton
                      onClick={() => void handleConnect()}
                      loading={loading}
                      label="Connecter Google Calendar"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Prochains événements détectés dans votre calendrier principal
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void loadEvents(token)}
                        disabled={loading}
                        className="ios-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        Actualiser
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDisconnect()}
                        className="ios-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 whitespace-nowrap"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Déconnecter
                      </button>
                    </div>
                  </div>

                  {loading && events.length === 0 ? (
                    <div className="py-10 text-center text-sm text-slate-500">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                      Chargement des événements Google Calendar...
                    </div>
                  ) : events.length === 0 ? (
                    <div className="ios-glass-subtle rounded-[20px] p-6 text-center text-sm text-slate-500">
                      Aucun événement à venir trouvé dans votre calendrier principal.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-900/[0.06] dark:divide-white/[0.08] ios-glass-subtle rounded-[20px] overflow-hidden">
                      {events.map((item) => {
                        const iso = item.start?.dateTime || item.start?.date || '';
                        const isImported = importedIds[item.id];
                        return (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-4 p-4 hover:bg-white/40 dark:hover:bg-white/[0.04] transition-colors"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                                {item.summary || 'Événement sans titre'}
                              </div>
                              <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                {iso ? formatFrenchDateTime(iso) : 'Date non définie'}
                                {item.location ? ` · ${item.location}` : ''}
                              </div>
                            </div>

                            <button
                              type="button"
                              disabled={importingId === item.id || isImported}
                              onClick={() => void handleImport(item)}
                              className={`inline-flex items-center gap-1.5 rounded-[12px] px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap shrink-0 ios-press ${
                                isImported
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25'
                                  : 'ios-btn-primary'
                              }`}
                            >
                              {importingId === item.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : isImported ? (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              ) : (
                                <Plus className="w-3.5 h-3.5" />
                              )}
                              {isImported ? 'Importé' : 'Importer'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {error && (
                <div className="rounded-[14px] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                  {error}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const CalendarExportConfirmModal: React.FC<{
  event: CountdownEvent | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ event, loading, onCancel, onConfirm }) => {
  return (
    <AnimatePresence>
      {event && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/45 backdrop-blur-md p-0 sm:p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="ios-glass-modal w-full max-w-md rounded-t-[28px] sm:rounded-[28px] p-6 space-y-4"
          >
            <div className="w-10 h-1 rounded-full bg-slate-400/40 mx-auto sm:hidden" />
            <div className="flex items-center gap-2.5 text-slate-900 dark:text-slate-100">
              <Calendar className="w-5 h-5 text-[#007AFF] dark:text-[#0A84FF] shrink-0" />
              <h3 className="text-base font-semibold">Ajouter à Google Calendar ?</h3>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Voulez-vous créer un événement dans votre calendrier Google principal pour{' '}
              <strong className="font-semibold text-slate-900 dark:text-slate-100">
                {event.title}
              </strong>{' '}
              le {formatFrenchDateTime(event.targetIso)} ?
            </p>
            {event.locationAddress && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Lieu inclus : {event.locationAddress}
              </p>
            )}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="ios-btn-secondary px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className="ios-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50 whitespace-nowrap"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirmer l'ajout
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
