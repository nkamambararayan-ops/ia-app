import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { MapPin, Navigation, Search, X } from 'lucide-react';
import { CountdownEvent } from '../types';
import { formatShortDate } from '../lib/time';
import { formatDistanceFr, formatRelativeAgeFr, GeoPoint } from '../lib/geo';
import { NearbyParticipant } from '../hooks/useCollectiveLocations';

export interface SelectedPlacePayload {
  locationName: string;
  locationAddress: string;
  locationLat: number;
  locationLng: number;
  placeId: string;
}

interface PlaceAutocompleteInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onPlaceSelected: (place: SelectedPlacePayload) => void;
  onClear?: () => void;
  mapsAvailable: boolean;
}

export const PlaceAutocompleteInput: React.FC<PlaceAutocompleteInputProps> = ({
  value,
  onChangeText,
  onPlaceSelected,
  onClear,
  mapsAvailable,
}) => {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!mapsAvailable || !placesLib || !value.trim() || value.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: value,
          sessionToken: sessionTokenRef.current,
        });
        setSuggestions(res.suggestions || []);
        setOpen((res.suggestions || []).length > 0);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        setSuggestions([]);
      }
    }, 260);

    return () => clearTimeout(timer);
  }, [mapsAvailable, placesLib, value]);

  const handleSelect = useCallback(
    async (suggestion: google.maps.places.AutocompleteSuggestion) => {
      if (!placesLib || !suggestion.placePrediction) return;
      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: ['id', 'displayName', 'formattedAddress', 'location'],
        });
        const loc = place.location;
        if (loc) {
          const name = place.displayName || suggestion.placePrediction.text.text;
          const address = place.formattedAddress || suggestion.placePrediction.text.text;
          onPlaceSelected({
            locationName: name,
            locationAddress: address,
            locationLat: loc.lat(),
            locationLng: loc.lng(),
            placeId: place.id || '',
          });
          onChangeText(address);
        }
        sessionTokenRef.current = null;
        setSuggestions([]);
        setOpen(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
      }
    },
    [placesLib, onPlaceSelected, onChangeText]
  );

  return (
    <div className="relative">
      <div className="relative flex items-center">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChangeText(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          placeholder={
            mapsAvailable
              ? 'Rechercher un lieu ou une adresse (Google Places)...'
              : 'Nom du lieu ou adresse...'
          }
          className="ios-input w-full pl-9 pr-9 py-2 text-sm text-slate-900 dark:text-slate-100"
        />
        {value && onClear && (
          <button
            type="button"
            onClick={() => {
              onClear();
              setSuggestions([]);
              setOpen(false);
            }}
            aria-label="Effacer le lieu"
            className="absolute right-2.5 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ios-press"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul className="ios-glass-modal absolute z-40 mt-1.5 w-full rounded-[18px] max-h-56 overflow-y-auto divide-y divide-slate-900/[0.06] dark:divide-white/[0.08]">
          {suggestions.map((s, idx) => (
            <li key={idx}>
              <button
                type="button"
                onClick={() => void handleSelect(s)}
                className="w-full text-left px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-200 hover:bg-white/60 dark:hover:bg-white/[0.06] flex items-start gap-2 transition-colors"
              >
                <MapPin className="w-4 h-4 text-[#007AFF] dark:text-[#0A84FF] shrink-0 mt-0.5" />
                <span className="truncate">{s.placePrediction?.text.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

interface EventMarkerItemProps {
  event: CountdownEvent;
  selected: boolean;
  onSelect: (event: CountdownEvent) => void;
}

const EventMarkerItem: React.FC<EventMarkerItemProps> = ({ event, selected, onSelect }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [infoOpen, setInfoOpen] = useState(selected);

  useEffect(() => {
    setInfoOpen(selected);
  }, [selected]);

  if (typeof event.locationLat !== 'number' || typeof event.locationLng !== 'number') {
    return null;
  }

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: event.locationLat, lng: event.locationLng }}
        onClick={() => {
          setInfoOpen(true);
          onSelect(event);
        }}
        title={event.title}
      >
        <Pin
          background={event.accentColor || '#d97706'}
          borderColor="#0f172a"
          glyphColor="#ffffff"
          scale={selected ? 1.25 : 1}
        />
      </AdvancedMarker>

      {infoOpen && marker && (
        <InfoWindow anchor={marker} onCloseClick={() => setInfoOpen(false)} maxWidth={240}>
          <div className="p-1 text-slate-900 space-y-1">
            <div className="font-semibold text-sm">{event.title}</div>
            <div className="text-xs text-slate-600">
              {event.locationName || event.locationAddress}
            </div>
            <div className="text-xs font-mono text-slate-500">
              {formatShortDate(event.targetIso)}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface ParticipantMarkerItemProps {
  participant: NearbyParticipant;
  selected: boolean;
  onSelect: (participant: NearbyParticipant) => void;
}

const ParticipantMarkerItem: React.FC<ParticipantMarkerItemProps> = ({
  participant,
  selected,
  onSelect,
}) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [infoOpen, setInfoOpen] = useState(selected);

  useEffect(() => {
    setInfoOpen(selected);
  }, [selected]);

  const initial = participant.displayName.trim().charAt(0).toUpperCase() || 'P';

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: participant.lat, lng: participant.lng }}
        onClick={() => {
          setInfoOpen(true);
          onSelect(participant);
        }}
        title={`${participant.displayName}${participant.isSelf ? ' (Vous)' : ''}`}
      >
        <div
          className={`flex items-center justify-center w-9 h-9 rounded-full border-2 border-white shadow-lg text-xs font-semibold text-white transition-transform ${
            participant.isSelf ? 'bg-[#007AFF]' : 'bg-emerald-600'
          } ${selected ? 'scale-115 ring-4 ring-emerald-400/40' : ''}`}
        >
          {initial}
        </div>
      </AdvancedMarker>

      {infoOpen && marker && (
        <InfoWindow anchor={marker} onCloseClick={() => setInfoOpen(false)} maxWidth={230}>
          <div className="p-1 text-slate-900 space-y-1">
            <div className="font-semibold text-sm">
              {participant.displayName}
              {participant.isSelf ? ' (Vous)' : ''}
            </div>
            {participant.distanceMeters !== null && !participant.isSelf && (
              <div className="text-xs font-medium text-emerald-700">
                À {formatDistanceFr(participant.distanceMeters)} de vous
              </div>
            )}
            <div className="text-[11px] text-slate-500">
              Mis à jour {formatRelativeAgeFr(participant.updatedAtMs ?? Date.now(), Date.now())}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface EventMapPanelProps {
  events: CountdownEvent[];
  focusedEvent: CountdownEvent | null;
  mapsAvailable: boolean;
  onSelectEvent?: (event: CountdownEvent) => void;
  myPosition?: GeoPoint | null;
  participantLocations?: NearbyParticipant[];
  focusedParticipantUid?: string | null;
  onSelectParticipant?: (participant: NearbyParticipant) => void;
}

export const EventMapPanel: React.FC<EventMapPanelProps> = ({
  events,
  focusedEvent,
  mapsAvailable,
  onSelectEvent,
  myPosition = null,
  participantLocations = [],
  focusedParticipantUid = null,
  onSelectParticipant,
}) => {
  const geoEvents = events.filter(
    (e) => typeof e.locationLat === 'number' && typeof e.locationLng === 'number'
  );

  const focusedParticipant = focusedParticipantUid
    ? participantLocations.find((p) => p.uid === focusedParticipantUid) ?? null
    : null;

  const hasSelfMarkerInList = participantLocations.some((p) => p.isSelf);

  const center = focusedParticipant
    ? { lat: focusedParticipant.lat, lng: focusedParticipant.lng }
    : myPosition && !focusedEvent?.locationLat && participantLocations.length > 0
      ? { lat: myPosition.lat, lng: myPosition.lng }
      : focusedEvent &&
          typeof focusedEvent.locationLat === 'number' &&
          typeof focusedEvent.locationLng === 'number'
        ? { lat: focusedEvent.locationLat, lng: focusedEvent.locationLng }
        : participantLocations[0]
          ? { lat: participantLocations[0].lat, lng: participantLocations[0].lng }
          : geoEvents[0]
            ? { lat: geoEvents[0].locationLat!, lng: geoEvents[0].locationLng! }
            : myPosition
              ? { lat: myPosition.lat, lng: myPosition.lng }
              : { lat: 48.8566, lng: 2.3522 };

  if (!mapsAvailable) {
    return (
      <div className="ios-glass-subtle rounded-[22px] p-8 text-center space-y-2">
        <MapPin className="w-6 h-6 text-slate-400 mx-auto" />
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Carte Google Maps en attente de clé API navigateur
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {focusedEvent?.locationAddress ||
            focusedEvent?.locationName ||
            'Ajoutez un lieu à vos événements pour les localiser.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="w-full h-[380px] rounded-[22px] overflow-hidden border border-slate-900/[0.08] dark:border-white/[0.1] shadow-sm">
        <GoogleMap
          mapId="DEMO_MAP_ID"
          defaultCenter={center}
          center={center}
          defaultZoom={focusedEvent?.locationLat || participantLocations.length > 0 || myPosition ? 13 : 5}
          gestureHandling="greedy"
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          style={{ width: '100%', height: '100%' }}
        >
          {geoEvents.map((ev) => (
            <EventMarkerItem
              key={ev.id}
              event={ev}
              selected={focusedEvent?.id === ev.id && !focusedParticipant}
              onSelect={(selectedEv) => onSelectEvent?.(selectedEv)}
            />
          ))}

          {myPosition && !hasSelfMarkerInList && (
            <AdvancedMarker
              position={{ lat: myPosition.lat, lng: myPosition.lng }}
              title="Votre position actuelle"
            >
              <div className="w-5 h-5 rounded-full bg-[#007AFF] border-[3px] border-white shadow-md ring-4 ring-[#007AFF]/25" />
            </AdvancedMarker>
          )}

          {participantLocations.map((participant) => (
            <ParticipantMarkerItem
              key={participant.uid}
              participant={participant}
              selected={focusedParticipantUid === participant.uid}
              onSelect={(p) => onSelectParticipant?.(p)}
            />
          ))}
        </GoogleMap>
      </div>

      {focusedEvent &&
        typeof focusedEvent.locationLat === 'number' &&
        typeof focusedEvent.locationLng === 'number' && (
          <div className="ios-glass-subtle flex flex-wrap items-center justify-between gap-3 rounded-[18px] px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                {focusedEvent.locationName || focusedEvent.locationAddress}
              </div>
              {focusedEvent.locationAddress && (
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {focusedEvent.locationAddress}
                </div>
              )}
            </div>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${focusedEvent.locationLat},${focusedEvent.locationLng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ios-btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs whitespace-nowrap shrink-0"
            >
              <Navigation className="w-3.5 h-3.5" />
              Itinéraire Google Maps
            </a>
          </div>
        )}
    </div>
  );
};
