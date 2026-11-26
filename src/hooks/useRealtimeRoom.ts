import { useCallback, useEffect, useRef, useState } from 'react';

export interface PresenceParticipant {
  clientId: string;
  displayName: string;
}

export interface ReactionBurst {
  id: string;
  emoji: string;
  displayName: string;
}

export interface PeerLocation {
  uid: string;
  displayName: string;
  lat: number;
  lng: number;
  accuracy?: number;
  updatedAtMs: number;
}

export function useRealtimeRoom(roomId: string | null, displayName: string, clientId: string) {
  const [participants, setParticipants] = useState<PresenceParticipant[]>([]);
  const [peerLocations, setPeerLocations] = useState<PeerLocation[]>([]);
  const [connected, setConnected] = useState(false);
  const [reactions, setReactions] = useState<ReactionBurst[]>([]);
  const [lastActivity, setLastActivity] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!roomId) {
      setParticipants([]);
      setPeerLocations([]);
      setConnected(false);
      return;
    }

    let disposed = false;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        ws.send(
          JSON.stringify({
            type: 'join_room',
            roomId,
            clientId,
            displayName,
          })
        );
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'presence_update' && msg.roomId === roomId) {
            setParticipants(Array.isArray(msg.participants) ? msg.participants : []);
          } else if (msg.type === 'locations_snapshot' && msg.roomId === roomId) {
            setPeerLocations(Array.isArray(msg.locations) ? msg.locations : []);
          } else if (msg.type === 'reaction_burst' && msg.roomId === roomId) {
            const burst: ReactionBurst = {
              id: String(msg.id || Date.now()),
              emoji: String(msg.emoji || '✨'),
              displayName: String(msg.displayName || 'Participant'),
            };
            setReactions((prev) => [...prev.slice(-11), burst]);
            window.setTimeout(() => {
              setReactions((prev) => prev.filter((item) => item.id !== burst.id));
            }, 3400);
          } else if (msg.type === 'event_activity' && msg.roomId === roomId) {
            setLastActivity(`${msg.actor} a mis à jour cet événement`);
            window.setTimeout(() => setLastActivity(null), 3500);
          }
        } catch {
          // Ignore malformed server frame
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!disposed) {
          const delay = Math.min(8000, 1000 * Math.pow(1.6, attempt));
          attempt += 1;
          reconnectTimerRef.current = window.setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId, displayName, clientId]);

  const sendReaction = useCallback(
    (emoji: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'reaction',
            emoji,
            displayName,
          })
        );
      }
    },
    [displayName]
  );

  const notifyActivity = useCallback(
    (kind: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'event_activity',
            kind,
            displayName,
          })
        );
      }
    },
    [displayName]
  );

  const sendLocationUpdate = useCallback((lat: number, lng: number, accuracy?: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'location_update',
          lat,
          lng,
          accuracy,
        })
      );
    }
  }, []);

  const sendLocationStop = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'location_stop',
        })
      );
    }
  }, []);

  return {
    participants,
    peerLocations,
    connected,
    reactions,
    lastActivity,
    sendReaction,
    notifyActivity,
    sendLocationUpdate,
    sendLocationStop,
  };
}
