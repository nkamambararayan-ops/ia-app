import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Sparkles, X, Loader2, Users, Lock } from 'lucide-react';
import {
  ACCENT_COLORS,
  CATEGORY_LABELS,
  CountdownCategory,
  CountdownEvent,
  CountdownScope,
  COVER_IMAGES,
  COVER_LABELS,
  CoverKey,
  FIELD_LIMITS,
} from '../types';
import { toLocalDateTimeInputValue } from '../lib/time';
import { PlaceAutocompleteInput, SelectedPlacePayload } from './EventMapPanel';

interface CreateEventModalProps {
  isOpen: boolean;
  editingEvent: CountdownEvent | null;
  mapsAvailable: boolean;
  aiEnabled: boolean;
  onClose: () => void;
  onSave: (payload: {
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
  }) => Promise<void>;
}

export const CreateEventModal: React.FC<CreateEventModalProps> = ({
  isOpen,
  editingEvent,
  mapsAvailable,
  aiEnabled,
  onClose,
  onSave,
}) => {
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetLocal, setTargetLocal] = useState(toLocalDateTimeInputValue());
  const [scope, setScope] = useState<CountdownScope>('personal');
  const [category, setCategory] = useState<CountdownCategory>('celebration');
  const [coverKey, setCoverKey] = useState<CoverKey>('celebration');
  const [accentColor, setAccentColor] = useState(ACCENT_COLORS[0].id);

  const [locationText, setLocationText] = useState('');
  const [placeData, setPlaceData] = useState<SelectedPlacePayload | null>(null);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setFormError(null);
    setAiError(null);
    if (editingEvent) {
      setTitle(editingEvent.title);
      setDescription(editingEvent.description || '');
      setTargetLocal(toLocalDateTimeInputValue(editingEvent.targetIso));
      setScope(editingEvent.scope);
      setCategory(editingEvent.category);
      setCoverKey(editingEvent.coverKey);
      setAccentColor(editingEvent.accentColor || ACCENT_COLORS[0].id);
      setLocationText(editingEvent.locationAddress || editingEvent.locationName || '');
      if (
        typeof editingEvent.locationLat === 'number' &&
        typeof editingEvent.locationLng === 'number'
      ) {
        setPlaceData({
          locationName: editingEvent.locationName || '',
          locationAddress: editingEvent.locationAddress || '',
          locationLat: editingEvent.locationLat,
          locationLng: editingEvent.locationLng,
          placeId: editingEvent.placeId || '',
        });
      } else {
        setPlaceData(null);
      }
    } else {
      setAiPrompt('');
      setTitle('');
      setDescription('');
      setTargetLocal(toLocalDateTimeInputValue());
      setScope('personal');
      setCategory('celebration');
      setCoverKey('celebration');
      setAccentColor(ACCENT_COLORS[0].id);
      setLocationText('');
      setPlaceData(null);
    }
  }, [isOpen, editingEvent]);

  const handleAiParse = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch('/api/ai/parse-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promptText: aiPrompt.trim(),
          nowIso: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Analyse impossible');
      }
      if (data.title) setTitle(String(data.title).slice(0, FIELD_LIMITS.titleMax));
      if (data.description)
        setDescription(String(data.description).slice(0, FIELD_LIMITS.descriptionMax));
      if (data.targetIso && !Number.isNaN(new Date(data.targetIso).getTime())) {
        setTargetLocal(toLocalDateTimeInputValue(data.targetIso));
      }
      if (data.scope === 'collective' || data.scope === 'personal') {
        setScope(data.scope);
      }
      if (['celebration', 'voyage', 'launch', 'focus', 'other'].includes(data.category)) {
        setCategory(data.category);
        if (data.category !== 'other') {
          setCoverKey(data.category as CoverKey);
        }
      }
      if (data.locationQuery) {
        setLocationText(String(data.locationQuery));
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Erreur IA');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("Veuillez saisir un titre pour l'événement.");
      return;
    }

    const targetDate = new Date(targetLocal);
    if (Number.isNaN(targetDate.getTime())) {
      setFormError('Veuillez choisir une date et une heure valides.');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        title: trimmedTitle.slice(0, FIELD_LIMITS.titleMax),
        description: description.trim().slice(0, FIELD_LIMITS.descriptionMax),
        targetIso: targetDate.toISOString(),
        scope,
        category,
        coverKey,
        accentColor,
        locationName: (placeData?.locationName || locationText).trim().slice(0, FIELD_LIMITS.locationNameMax) || undefined,
        locationAddress: (placeData?.locationAddress || locationText).trim().slice(0, FIELD_LIMITS.locationAddressMax) || undefined,
        locationLat: placeData?.locationLat,
        locationLng: placeData?.locationLng,
        placeId: placeData?.placeId || undefined,
      });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/45 backdrop-blur-md p-0 sm:p-4 overflow-y-auto"
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="ios-glass-modal w-full max-w-2xl rounded-t-[28px] sm:rounded-[28px] sm:my-8 overflow-hidden"
          >
            <div className="pt-2.5 sm:hidden">
              <div className="w-10 h-1 rounded-full bg-slate-400/40 mx-auto" />
            </div>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-900/[0.06] dark:border-white/[0.08]">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {editingEvent ? "Modifier l'événement" : 'Nouveau compte à rebours'}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="p-2 rounded-full text-slate-500 hover:bg-slate-900/5 dark:hover:bg-white/10 ios-press"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
              {!editingEvent && aiEnabled && (
                <div className="ios-glass-subtle rounded-[18px] p-4 space-y-2.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Pré-remplissage intelligent par IA
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="Ex : Anniversaire collectif de Clara le 18 décembre à 20h à Lyon"
                      className="ios-input flex-1 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => void handleAiParse()}
                      disabled={aiLoading || !aiPrompt.trim()}
                      className="ios-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      {aiLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      Générer
                    </button>
                  </div>
                  {aiError && <p className="text-xs text-rose-600 dark:text-rose-400">{aiError}</p>}
                </div>
              )}

              {/* Scope switcher */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Portée du compte à rebours
                </label>
                <div className="ios-segmented grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setScope('personal')}
                    className={`flex items-center justify-center gap-2 rounded-[10px] py-2 px-3 text-sm font-medium transition-all whitespace-nowrap ios-press ${
                      scope === 'personal'
                        ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <Lock className="w-4 h-4" />
                    Personnel (privé)
                  </button>
                  <button
                    type="button"
                    onClick={() => setScope('collective')}
                    className={`flex items-center justify-center gap-2 rounded-[10px] py-2 px-3 text-sm font-medium transition-all whitespace-nowrap ios-press ${
                      scope === 'collective'
                        ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    Collectif (partagé)
                  </button>
                </div>
              </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Titre de l'événement *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.titleMax}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex : Départ au Japon, Lancement v2..."
                className="ios-input w-full px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Date et heure cible *
              </label>
              <input
                type="datetime-local"
                required
                value={targetLocal}
                onChange={(e) => setTargetLocal(e.target.value)}
                className="ios-input w-full px-3.5 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Catégorie
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as CountdownCategory)}
                className="ios-input w-full px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100"
              >
                {(Object.keys(CATEGORY_LABELS) as CountdownCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Couleur d'accent
              </label>
              <div className="flex items-center gap-2 pt-1">
                {ACCENT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setAccentColor(c.id)}
                    title={c.label}
                    className={`w-7 h-7 rounded-full border-2 transition-transform ${
                      accentColor === c.id
                        ? 'border-slate-900 dark:border-white scale-110'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: c.id }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Lieu (avec localisation Google Maps)
            </label>
            <PlaceAutocompleteInput
              value={locationText}
              onChangeText={(txt) => {
                setLocationText(txt);
                if (!txt) setPlaceData(null);
              }}
              onPlaceSelected={(place) => setPlaceData(place)}
              onClear={() => {
                setLocationText('');
                setPlaceData(null);
              }}
              mapsAvailable={mapsAvailable}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Description
            </label>
            <textarea
              rows={3}
              maxLength={FIELD_LIMITS.descriptionMax}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Contexte, programme ou message pour les participants..."
              className="ios-input w-full px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100"
            />
          </div>

          {/* Curated cover selection */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Illustration de couverture
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {(Object.keys(COVER_IMAGES) as CoverKey[]).map((k) => {
                const selected = coverKey === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setCoverKey(k)}
                    className={`group relative rounded-[16px] overflow-hidden border-2 text-left transition-all ios-press ${
                      selected
                        ? 'border-[#007AFF] dark:border-[#0A84FF] shadow-md'
                        : 'border-slate-900/10 dark:border-white/10 opacity-80 hover:opacity-100'
                    }`}
                  >
                    <div className="aspect-video w-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <img
                        src={COVER_IMAGES[k]}
                        alt={COVER_LABELS[k]}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="px-2.5 py-1.5 text-[11px] font-medium text-slate-800 dark:text-slate-200 truncate bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
                      {COVER_LABELS[k]}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {formError && (
            <div className="rounded-[14px] border border-rose-500/25 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-700 dark:text-rose-300">
              {formError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-900/[0.06] dark:border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="ios-btn-secondary px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="ios-btn-primary inline-flex items-center gap-2 px-5 py-2 text-sm disabled:opacity-50 whitespace-nowrap"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editingEvent ? 'Enregistrer' : 'Créer le compte à rebours'}
            </button>
          </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
