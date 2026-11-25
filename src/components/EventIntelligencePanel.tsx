import React, { useState } from 'react';
import {
  BookmarkPlus,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  Music,
  Search,
  Trash2,
} from 'lucide-react';
import {
  CountdownEvent,
  COVER_IMAGES,
  GroundingLink,
  ReviewSnippet,
  SavedResearchNote,
  SavedSoundtrack,
} from '../types';

interface MapsGroundingPanelProps {
  event: CountdownEvent;
  isAuthenticated: boolean;
  onSaveResearch: (payload: {
    sourceType: 'maps_grounding';
    query: string;
    summary: string;
    links: GroundingLink[];
  }) => Promise<void>;
}

export const MapsGroundingPanel: React.FC<MapsGroundingPanelProps> = ({
  event,
  isAuthenticated,
  onSaveResearch,
}) => {
  const [query, setQuery] = useState(
    event.locationName
      ? `Meilleurs restaurants, parkings et accès près de ${event.locationName}`
      : 'Lieux emblématiques, restaurants et transports à proximité'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    text: string;
    links: GroundingLink[];
    reviewSnippets: ReviewSnippet[];
  } | null>(null);

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);

    try {
      let lat = event.locationLat;
      let lng = event.locationLng;

      if ((typeof lat !== 'number' || typeof lng !== 'number') && navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              lat = pos.coords.latitude;
              lng = pos.coords.longitude;
              resolve();
            },
            () => resolve(),
            { timeout: 2500 }
          );
        });
      }

      const res = await fetch('/api/ai/maps-grounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          lat,
          lng,
          locationContext: event.locationAddress || event.locationName || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Exploration locale impossible');
      setResult({
        text: String(data.text || ''),
        links: Array.isArray(data.links) ? data.links : [],
        reviewSnippets: Array.isArray(data.reviewSnippets) ? data.reviewSnippets : [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur Google Maps Grounding');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ios-glass-subtle rounded-[20px] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-[#007AFF] dark:text-[#0A84FF]" />
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Découverte locale Google Maps
          </h4>
        </div>
      </div>

      <form onSubmit={(e) => void runSearch(e)} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Restaurants, hôtels, parkings ou accès autour du lieu..."
          className="ios-input flex-1 px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="ios-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs disabled:opacity-50 whitespace-nowrap"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Explorer
        </button>
      </form>

      {error && (
        <div className="rounded-[14px] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3 rounded-[16px] bg-white/75 dark:bg-white/[0.04] border border-slate-900/[0.06] dark:border-white/[0.08] p-4">
          <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
            {result.text}
          </div>

          {result.links.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-slate-900/[0.06] dark:border-white/[0.08]">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                Lieux vérifiés sur Google Maps :
              </div>
              <div className="flex flex-wrap gap-2">
                {result.links.map((link, idx) => (
                  <a
                    key={`${link.uri}_${idx}`}
                    href={link.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ios-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#007AFF] dark:text-[#0A84FF]"
                  >
                    <ExternalLink className="w-3 h-3 shrink-0" />
                    <span>{link.title}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {result.reviewSnippets.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                Extraits d'avis Google Maps :
              </div>
              <div className="space-y-1.5">
                {result.reviewSnippets.slice(0, 3).map((r, i) => (
                  <div key={i} className="text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-semibold">{r.title} : </span>
                    <span>« {r.snippet} »</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAuthenticated && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() =>
                  void onSaveResearch({
                    sourceType: 'maps_grounding',
                    query,
                    summary: result.text,
                    links: result.links,
                  })
                }
                className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                Enregistrer cette fiche
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface EventIntelligencePanelProps {
  event: CountdownEvent;
  isAuthenticated: boolean;
  savedSoundtracks: SavedSoundtrack[];
  savedResearchNotes: SavedResearchNote[];
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
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(blob);
    });
    const parts = dataUrl.split(',');
    if (parts.length !== 2) return null;
    return { data: parts[1], mimeType: blob.type || 'image/jpeg' };
  } catch {
    return null;
  }
}

export const EventIntelligencePanel: React.FC<EventIntelligencePanelProps> = ({
  event,
  isAuthenticated,
  savedSoundtracks,
  savedResearchNotes,
  onSaveSoundtrack,
  onDeleteSoundtrack,
  onSaveResearch,
  onDeleteResearch,
}) => {
  // Search Grounding State
  const [searchQuery, setSearchQuery] = useState(
    `Météo saisonnière, jours fériés et infos pratiques pour ${event.title}${
      event.locationName ? ` à ${event.locationName}` : ''
    }`
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<{
    text: string;
    links: GroundingLink[];
  } | null>(null);

  // Lyria Music State
  const [musicModel, setMusicModel] = useState<'lyria-3-clip-preview' | 'lyria-3-pro-preview'>(
    'lyria-3-clip-preview'
  );
  const [musicPrompt, setMusicPrompt] = useState(
    `Thème musical inspirant et chaleureux pour « ${event.title} » (${event.category})`
  );
  const [useCoverContext, setUseCoverContext] = useState(true);
  const [musicLoading, setMusicLoading] = useState(false);
  const [musicError, setMusicError] = useState<string | null>(null);
  const [generatedTrack, setGeneratedTrack] = useState<{
    audioDataUrl: string;
    mimeType: string;
    lyrics: string;
    model: string;
    prompt: string;
  } | null>(null);

  const handleWebSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await fetch('/api/ai/search-grounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQuery.trim(),
          eventContext: `${event.title} (${event.targetIso}) ${event.locationAddress || ''}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Recherche web impossible');
      setSearchResult({
        text: String(data.text || ''),
        links: Array.isArray(data.links) ? data.links : [],
      });
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Erreur recherche web');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleGenerateMusic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!musicPrompt.trim()) return;
    setMusicLoading(true);
    setMusicError(null);
    try {
      let imagePayload: { data: string; mimeType: string } | null = null;
      if (useCoverContext) {
        imagePayload = await fetchImageAsBase64(
          COVER_IMAGES[event.coverKey] || COVER_IMAGES.celebration
        );
      }
      const res = await fetch('/api/ai/generate-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: musicPrompt.trim(),
          model: musicModel,
          imageBase64: imagePayload?.data,
          imageMimeType: imagePayload?.mimeType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Génération musicale impossible');

      const track = {
        audioDataUrl: String(data.audioDataUrl),
        mimeType: String(data.mimeType || 'audio/mpeg'),
        lyrics: String(data.lyrics || ''),
        model: String(data.model || musicModel),
        prompt: musicPrompt.trim(),
      };
      setGeneratedTrack(track);
      if (isAuthenticated) {
        await onSaveSoundtrack(track);
      }
    } catch (err) {
      setMusicError(err instanceof Error ? err.message : 'Erreur studio musical');
    } finally {
      setMusicLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Section 1: Google Search Grounding */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-sky-600" />
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Recherche Web en direct
          </h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Vérifiez l'actualité, les prévisions saisonnières, la logistique ou les événements publics liés à votre compte à rebours.
        </p>

        <form onSubmit={(e) => void handleWebSearch(e)} className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher des informations actualisées sur le web..."
            className="ios-input flex-1 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={searchLoading || !searchQuery.trim()}
            className="ios-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs disabled:opacity-50 whitespace-nowrap"
          >
            {searchLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
            Rechercher
          </button>
        </form>

        {searchError && (
          <div className="rounded-[14px] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {searchError}
          </div>
        )}

        {searchResult && (
          <div className="ios-glass-subtle rounded-[20px] p-4 space-y-3">
            <div className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
              {searchResult.text}
            </div>

            {searchResult.links.length > 0 && (
              <div className="pt-2 border-t border-slate-900/[0.06] dark:border-white/[0.08] space-y-1.5">
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Sources Google Search :
                </div>
                <div className="flex flex-wrap gap-2">
                  {searchResult.links.map((link, idx) => (
                    <a
                      key={`${link.uri}_${idx}`}
                      href={link.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ios-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#007AFF] dark:text-[#0A84FF] max-w-[260px]"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{link.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {isAuthenticated && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    void onSaveResearch({
                      sourceType: 'search_grounding',
                      query: searchQuery,
                      summary: searchResult.text,
                      links: searchResult.links,
                    })
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#007AFF] dark:text-[#0A84FF] hover:underline ios-press"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  Enregistrer dans les notes
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 2: Lyria Music Generation */}
      <div className="pt-6 border-t border-slate-900/[0.06] dark:border-white/[0.08] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Music className="w-4 h-4 text-[#007AFF] dark:text-[#0A84FF]" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Studio musical de l'événement (Lyria)
            </h3>
          </div>

          <div className="ios-segmented inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMusicModel('lyria-3-clip-preview')}
              className={`px-2.5 py-1 rounded-[10px] text-xs font-medium transition-all whitespace-nowrap ios-press ${
                musicModel === 'lyria-3-clip-preview'
                  ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Extrait 30s (Lyria Clip)
            </button>
            <button
              type="button"
              onClick={() => setMusicModel('lyria-3-pro-preview')}
              className={`px-2.5 py-1 rounded-[10px] text-xs font-medium transition-all whitespace-nowrap ios-press ${
                musicModel === 'lyria-3-pro-preview'
                  ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Piste complète (Lyria Pro)
            </button>
          </div>
        </div>

        <form onSubmit={(e) => void handleGenerateMusic(e)} className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={musicPrompt}
              onChange={(e) => setMusicPrompt(e.target.value)}
              placeholder="Décrivez le style, les instruments et l'ambiance..."
              className="ios-input flex-1 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={musicLoading || !musicPrompt.trim()}
              className="ios-btn-primary inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs disabled:opacity-50 whitespace-nowrap"
            >
              {musicLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Music className="w-3.5 h-3.5" />
              )}
              Composer la bande sonore
            </button>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={useCoverContext}
              onChange={(e) => setUseCoverContext(e.target.checked)}
              className="rounded border-slate-300 dark:border-slate-700 accent-[#007AFF]"
            />
            Inspirer la composition à partir de l'image de couverture de l'événement
          </label>
        </form>

        {musicError && (
          <div className="rounded-[14px] border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200">
            {musicError}
          </div>
        )}

        {generatedTrack && (
          <div className="ios-glass-subtle rounded-[20px] p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-800 dark:text-slate-200">
                Composition générée ({generatedTrack.model})
              </span>
            </div>
            <audio controls src={generatedTrack.audioDataUrl} className="w-full" />
            {generatedTrack.lyrics && (
              <div className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap pt-1 border-t border-slate-900/[0.06] dark:border-white/[0.08]">
                {generatedTrack.lyrics}
              </div>
            )}
          </div>
        )}

        {/* Saved Soundtracks Library */}
        {savedSoundtracks.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              Bandes sonores enregistrées ({savedSoundtracks.length})
            </div>
            <div className="space-y-2">
              {savedSoundtracks.map((track) => (
                <div
                  key={track.id}
                  className="ios-glass-subtle rounded-[18px] p-3.5 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {track.prompt}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400">
                        {track.model}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onDeleteSoundtrack(track.id)}
                      aria-label="Supprimer la piste"
                      className="p-1.5 rounded-full text-slate-400 hover:text-rose-600 ios-press"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <audio controls src={track.audioDataUrl} className="w-full h-9" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Section 3: Saved Research Briefs */}
      {savedResearchNotes.length > 0 && (
        <div className="pt-6 border-t border-slate-900/[0.06] dark:border-white/[0.08] space-y-3">
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            Fiches et recherches enregistrées ({savedResearchNotes.length})
          </div>
          <div className="space-y-2.5">
            {savedResearchNotes.map((note) => {
              let links: GroundingLink[] = [];
              try {
                const parsed = JSON.parse(note.linksJson);
                if (Array.isArray(parsed)) links = parsed;
              } catch {
                // Ignore
              }
              return (
                <div
                  key={note.id}
                  className="ios-glass-subtle rounded-[18px] p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {note.query}
                    </div>
                    <button
                      type="button"
                      onClick={() => void onDeleteResearch(note.id)}
                      aria-label="Supprimer la fiche"
                      className="p-1 rounded-full text-slate-400 hover:text-rose-600 shrink-0 ios-press"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
                    {note.summary}
                  </p>
                  {links.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {links.map((l, i) => (
                        <a
                          key={i}
                          href={l.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#007AFF] dark:text-[#0A84FF] hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {l.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
