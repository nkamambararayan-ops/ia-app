import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { AuthRequest, requireAuth } from './src/middleware/auth.ts';
import {
  deleteSqlResearchNote,
  deleteSqlSoundtrack,
  getOrCreateUser,
  getUserEventSqlWorkspace,
  logSqlActivity,
  saveSqlResearchNote,
  saveSqlSoundtrack,
} from './src/db/users.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function classifyGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message:
        'Quota dépassé ou modèle réservé à une clé API payante. Sélectionnez une clé API avec facturation dans Settings > Secrets.',
    };
  }
  if (raw.includes('403') || raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      message:
        'Clé API Gemini refusée ou non configurée pour ce modèle. Vérifiez votre clé dans Settings > Secrets.',
    };
  }
  return { status: 500, message: raw || 'Erreur serveur IA' };
}

interface RoomMember {
  ws: WebSocket;
  clientId: string;
  displayName: string;
  location?: {
    lat: number;
    lng: number;
    accuracy?: number;
    updatedAtMs: number;
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  const server = http.createServer(app);

  // Two WebSocketServers routed cleanly via noServer + HTTP upgrade pathname
  const wssRooms = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
  const wssLive = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = request.url || '/';
    const pathname = reqUrl.split('?')[0];
    const protocol = request.headers['sec-websocket-protocol'] || '';

    if (pathname === '/ws') {
      wssRooms.handleUpgrade(request, socket, head, (ws) => {
        wssRooms.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/live') {
      wssLive.handleUpgrade(request, socket, head, (ws) => {
        wssLive.emit('connection', ws, request);
      });
    } else if (protocol.includes('vite-hmr') || protocol.includes('vite-ping')) {
      // Let Vite's middleware HMR WebSocketServer handle vite-hmr / vite-ping upgrades
      return;
    } else {
      socket.destroy();
    }
  });

  // 1) Collective Rooms WebSocket (/ws)
  const rooms = new Map<string, Map<string, RoomMember>>();

  function broadcastToRoom(roomId: string, payload: unknown, excludeClientId?: string) {
    const members = rooms.get(roomId);
    if (!members) return;
    const raw = JSON.stringify(payload);
    for (const [cid, member] of members.entries()) {
      if (excludeClientId && cid === excludeClientId) continue;
      if (member.ws.readyState === WebSocket.OPEN) {
        member.ws.send(raw);
      }
    }
  }

  function broadcastPresence(roomId: string) {
    const members = rooms.get(roomId);
    const list = members
      ? Array.from(members.values()).map((m) => ({
          clientId: m.clientId,
          displayName: m.displayName,
        }))
      : [];
    broadcastToRoom(roomId, {
      type: 'presence_update',
      roomId,
      count: list.length,
      participants: list,
    });
  }

  function broadcastLocations(roomId: string) {
    const members = rooms.get(roomId);
    const locations = members
      ? Array.from(members.values())
          .filter((m) => Boolean(m.location))
          .map((m) => ({
            uid: m.clientId,
            displayName: m.displayName,
            lat: m.location!.lat,
            lng: m.location!.lng,
            accuracy: m.location!.accuracy,
            updatedAtMs: m.location!.updatedAtMs,
          }))
      : [];
    broadcastToRoom(roomId, {
      type: 'locations_snapshot',
      roomId,
      locations,
    });
  }

  wssRooms.on('connection', (ws) => {
    let currentRoomId: string | null = null;
    let currentClientId = '';

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'join_room' && typeof msg.roomId === 'string') {
          const roomId = msg.roomId.slice(0, 128).replace(/[^a-zA-Z0-9_\-]/g, '');
          if (!roomId) return;

          if (currentRoomId && currentClientId) {
            const prev = rooms.get(currentRoomId);
            const prevMember = prev?.get(currentClientId);
            const hadLoc = Boolean(prevMember?.location);
            prev?.delete(currentClientId);
            if (prev && prev.size === 0) rooms.delete(currentRoomId);
            else {
              broadcastPresence(currentRoomId);
              if (hadLoc) broadcastLocations(currentRoomId);
            }
          }

          currentRoomId = roomId;
          currentClientId =
            typeof msg.clientId === 'string' && msg.clientId.length > 0
              ? msg.clientId.slice(0, 64)
              : `guest_${Math.random().toString(36).slice(2, 10)}`;
          const displayName =
            typeof msg.displayName === 'string' && msg.displayName.trim().length > 0
              ? msg.displayName.trim().slice(0, 50)
              : 'Participant';

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
          }
          rooms.get(roomId)!.set(currentClientId, { ws, clientId: currentClientId, displayName });
          broadcastPresence(roomId);
          broadcastLocations(roomId);
        } else if (msg.type === 'location_update' && currentRoomId && currentClientId) {
          const lat = typeof msg.lat === 'number' ? msg.lat : Number.NaN;
          const lng = typeof msg.lng === 'number' ? msg.lng : Number.NaN;
          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            lat < -90 ||
            lat > 90 ||
            lng < -180 ||
            lng > 180
          ) {
            return;
          }
          const rawAccuracy = typeof msg.accuracy === 'number' ? msg.accuracy : undefined;
          const accuracy =
            rawAccuracy !== undefined && Number.isFinite(rawAccuracy) && rawAccuracy >= 0
              ? Math.min(100000, Math.round(rawAccuracy))
              : undefined;
          const member = rooms.get(currentRoomId)?.get(currentClientId);
          if (member) {
            member.location = {
              lat,
              lng,
              accuracy,
              updatedAtMs: Date.now(),
            };
            broadcastLocations(currentRoomId);
          }
        } else if (msg.type === 'location_stop' && currentRoomId && currentClientId) {
          const member = rooms.get(currentRoomId)?.get(currentClientId);
          if (member && member.location) {
            delete member.location;
            broadcastLocations(currentRoomId);
          }
        } else if (msg.type === 'reaction' && currentRoomId) {
          const allowed = ['🎉', '🔥', '👏', '✨', '❤️', '🚀'];
          const emoji = allowed.includes(msg.emoji) ? msg.emoji : '✨';
          const sender =
            typeof msg.displayName === 'string'
              ? msg.displayName.trim().slice(0, 50)
              : 'Participant';
          broadcastToRoom(currentRoomId, {
            type: 'reaction_burst',
            roomId: currentRoomId,
            emoji,
            displayName: sender,
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          });
        } else if (msg.type === 'event_activity' && currentRoomId) {
          const kind = typeof msg.kind === 'string' ? msg.kind.slice(0, 32) : 'update';
          broadcastToRoom(
            currentRoomId,
            {
              type: 'event_activity',
              roomId: currentRoomId,
              kind,
              actor: typeof msg.displayName === 'string' ? msg.displayName.slice(0, 50) : 'Membre',
            },
            currentClientId
          );
        }
      } catch {
        // Ignore malformed websocket frames
      }
    });

    ws.on('close', () => {
      if (currentRoomId && currentClientId) {
        const members = rooms.get(currentRoomId);
        const departing = members?.get(currentClientId);
        const hadLoc = Boolean(departing?.location);
        members?.delete(currentClientId);
        if (members && members.size === 0) {
          rooms.delete(currentRoomId);
        } else {
          broadcastPresence(currentRoomId);
          if (hadLoc) broadcastLocations(currentRoomId);
        }
      }
    });
  });

  // 2) Gemini Live API Voice Bridge (/ws/live using gemini-3.8-live)
  wssLive.on('connection', (clientWs) => {
    const ai = getAiClient();
    if (!ai) {
      clientWs.send(
        JSON.stringify({
          error: 'Assistant vocal indisponible : GEMINI_API_KEY manquante dans Settings > Secrets.',
        })
      );
      clientWs.close();
      return;
    }

    let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
    let isClosed = false;

    const closeAll = () => {
      if (isClosed) return;
      isClosed = true;
      try {
        liveSession?.close();
      } catch {
        // Ignore close errors
      }
      liveSession = null;
    };

    clientWs.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'start' && !liveSession) {
          const allowedVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
          const voiceName = allowedVoices.includes(msg.voiceName) ? msg.voiceName : 'Zephyr';
          const eventTitle =
            typeof msg.eventTitle === 'string' ? msg.eventTitle.slice(0, 120) : 'Événement';
          const eventDate =
            typeof msg.eventDate === 'string' ? msg.eventDate.slice(0, 40) : '';
          const eventLocation =
            typeof msg.eventLocation === 'string' ? msg.eventLocation.slice(0, 160) : '';

          const systemInstruction = [
            "Tu es l'assistant vocal francophone de ChronoSphere, spécialisé dans la préparation d'événements et comptes à rebours.",
            `Événement actif : "${eventTitle}".`,
            eventDate ? `Date cible : ${eventDate}.` : '',
            eventLocation ? `Lieu : ${eventLocation}.` : '',
            'Réponds de façon concise, naturelle et chaleureuse en français.',
          ]
            .filter(Boolean)
            .join(' ');

          liveSession = await ai.live.connect({
            model: 'gemini-3.8-live',
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction,
            },
            callbacks: {
              onopen: () => {
                if (clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(JSON.stringify({ ready: true }));
                }
              },
              onmessage: (message: LiveServerMessage) => {
                if (clientWs.readyState !== WebSocket.OPEN) return;
                const content = message.serverContent;
                if (content?.inputTranscription?.text) {
                  clientWs.send(
                    JSON.stringify({ inputTranscript: content.inputTranscription.text })
                  );
                }
                if (content?.outputTranscription?.text) {
                  clientWs.send(
                    JSON.stringify({ outputTranscript: content.outputTranscription.text })
                  );
                }
                for (const part of content?.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
                  }
                }
                if (content?.interrupted) {
                  clientWs.send(JSON.stringify({ interrupted: true }));
                }
                if (content?.turnComplete) {
                  clientWs.send(JSON.stringify({ turnComplete: true }));
                }
              },
              onerror: (err) => {
                if (clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(
                    JSON.stringify({
                      error: err instanceof Error ? err.message : 'Erreur session vocale Live.',
                    })
                  );
                }
              },
              onclose: () => {
                if (clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(JSON.stringify({ closed: true }));
                }
              },
            },
          });
        } else if (msg.type === 'audio' && typeof msg.audio === 'string' && liveSession) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'text' && typeof msg.text === 'string' && liveSession) {
          liveSession.sendRealtimeInput({
            text: msg.text.slice(0, 600),
          });
        }
      } catch (err) {
        const info = classifyGeminiError(err);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ error: info.message }));
        }
      }
    });

    clientWs.on('close', closeAll);
    clientWs.on('error', closeAll);
  });

  // Public runtime capabilities endpoint (never exposes server secrets)
  app.get('/api/runtime-config', (_req, res) => {
    const mapsKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
    res.json({
      mapsApiKey: mapsKey,
      aiEnabled: Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ),
    });
  });

  // AI Route 1: Generate event preparation plan, checklist milestones & invitation message
  app.post('/api/ai/plan-event', async (req, res) => {
    try {
      const { title, scope, category, targetIso, locationName } = req.body ?? {};
      if (typeof title !== 'string' || title.trim().length < 2) {
        return res.status(400).json({ error: "Le titre de l'événement est requis." });
      }

      const ai = getAiClient();
      if (!ai) {
        return res.status(503).json({
          error: 'Assistant IA non configuré. Vérifiez GEMINI_API_KEY dans Settings > Secrets.',
        });
      }

      const prompt = [
        `Tu es un assistant d'organisation d'événements francophone.`,
        `Événement : "${title.trim().slice(0, 120)}"`,
        `Type : ${scope === 'collective' ? 'Collectif (plusieurs participants)' : 'Personnel'}`,
        `Catégorie : ${String(category || 'other')}`,
        targetIso ? `Date cible ISO : ${String(targetIso).slice(0, 40)}` : '',
        locationName ? `Lieu : ${String(locationName).slice(0, 120)}` : '',
        `Génère en français :`,
        `1. Une description inspirante et concise (2 à 3 phrases max).`,
        `2. Un message d'invitation chaleureux prêt à partager.`,
        `3. Une liste de 4 à 6 étapes clés de préparation (jalons), avec le nombre de jours avant l'événement (daysBefore >= 0).`,
      ]
        .filter(Boolean)
        .join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              description: { type: Type.STRING },
              invitationMessage: { type: Type.STRING },
              milestones: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    daysBefore: { type: Type.INTEGER },
                  },
                },
              },
            },
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      return res.json(parsed);
    } catch (err) {
      const info = classifyGeminiError(err);
      return res.status(info.status).json({ error: info.message });
    }
  });

  // AI Route 2: Parse natural-language prompt into structured countdown fields
  app.post('/api/ai/parse-prompt', async (req, res) => {
    try {
      const { promptText, nowIso } = req.body ?? {};
      if (typeof promptText !== 'string' || promptText.trim().length < 3) {
        return res.status(400).json({ error: 'Veuillez décrire votre événement.' });
      }

      const ai = getAiClient();
      if (!ai) {
        return res.status(503).json({
          error: 'Assistant IA non configuré. Vérifiez GEMINI_API_KEY dans Settings > Secrets.',
        });
      }

      const refDate =
        typeof nowIso === 'string' ? nowIso.slice(0, 40) : new Date().toISOString();

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Date et heure actuelles de référence : ${refDate}.\nAnalyse cette demande en français pour créer un compte à rebours : "${promptText.trim().slice(0, 400)}"`,
        config: {
          systemInstruction:
            "Extrais un titre clair, une courte description, une date cible ISO 8601 future valide (targetIso), le type ('personal' ou 'collective'), la catégorie ('celebration', 'voyage', 'launch', 'focus', ou 'other'), et un lieu éventuel (locationQuery).",
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              targetIso: { type: Type.STRING },
              scope: { type: Type.STRING },
              category: { type: Type.STRING },
              locationQuery: { type: Type.STRING },
            },
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      return res.json(parsed);
    } catch (err) {
      const info = classifyGeminiError(err);
      return res.status(info.status).json({ error: info.message });
    }
  });

  // AI Route 3: Google Maps Grounding (gemini-4-hydrogen + googleMaps)
  app.post('/api/ai/maps-grounding', async (req, res) => {
    try {
      const { query, lat, lng, locationContext } = req.body ?? {};
      if (typeof query !== 'string' || query.trim().length < 2) {
        return res.status(400).json({ error: 'Veuillez saisir une question géographique.' });
      }

      const ai = getAiClient();
      if (!ai) {
        return res.status(503).json({
          error: 'Assistant IA non configuré. Vérifiez GEMINI_API_KEY dans Settings > Secrets.',
        });
      }

      const hasCoords =
        typeof lat === 'number' &&
        Number.isFinite(lat) &&
        typeof lng === 'number' &&
        Number.isFinite(lng);

      const prompt = locationContext
        ? `Contexte du lieu de l'événement : ${String(locationContext).slice(0, 200)}.\nQuestion : ${query.trim().slice(0, 400)}`
        : query.trim().slice(0, 400);

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          tools: [{ googleMaps: {} }],
          ...(hasCoords
            ? {
                toolConfig: {
                  retrievalConfig: {
                    latLng: {
                      latitude: lat,
                      longitude: lng,
                    },
                  },
                },
              }
            : {}),
        },
      });

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const links: Array<{ title: string; uri: string }> = [];
      const reviewSnippets: Array<{ title: string; snippet: string; uri?: string }> = [];

      for (const chunk of chunks as Array<{
        maps?: {
          uri?: string;
          title?: string;
          placeAnswerSources?: {
            reviewSnippets?: Array<{
              title?: string;
              reviewText?: string;
              googleMapsUri?: string;
            }>;
          };
        };
      }>) {
        if (chunk.maps?.uri) {
          links.push({
            title: chunk.maps.title || 'Lieu Google Maps',
            uri: chunk.maps.uri,
          });
        }
        const reviews = chunk.maps?.placeAnswerSources?.reviewSnippets ?? [];
        for (const r of reviews) {
          if (r.reviewText) {
            reviewSnippets.push({
              title: chunk.maps?.title || r.title || 'Avis Google Maps',
              snippet: r.reviewText,
              uri: r.googleMapsUri || chunk.maps?.uri,
            });
          }
        }
      }

      return res.json({
        text: response.text ?? '',
        links,
        reviewSnippets,
      });
    } catch (err) {
      const info = classifyGeminiError(err);
      return res.status(info.status).json({ error: info.message });
    }
  });

  // AI Route 4: Google Search Grounding (gemini-4-hydrogen + googleSearch)
  app.post('/api/ai/search-grounding', async (req, res) => {
    try {
      const { query, eventContext } = req.body ?? {};
      if (typeof query !== 'string' || query.trim().length < 2) {
        return res.status(400).json({ error: 'Veuillez saisir une recherche.' });
      }

      const ai = getAiClient();
      if (!ai) {
        return res.status(503).json({
          error: 'Assistant IA non configuré. Vérifiez GEMINI_API_KEY dans Settings > Secrets.',
        });
      }

      const prompt = eventContext
        ? `Contexte de l'événement : ${String(eventContext).slice(0, 240)}.\nRéponds en français à cette recherche actualisée : ${query.trim().slice(0, 400)}`
        : `Réponds en français avec des informations à jour : ${query.trim().slice(0, 400)}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const links: Array<{ title: string; uri: string }> = [];
      for (const chunk of chunks as Array<{ web?: { uri?: string; title?: string } }>) {
        if (chunk.web?.uri) {
          links.push({
            title: chunk.web.title || chunk.web.uri,
            uri: chunk.web.uri,
          });
        }
      }

      return res.json({
        text: response.text ?? '',
        links,
      });
    } catch (err) {
      const info = classifyGeminiError(err);
      return res.status(info.status).json({ error: info.message });
    }
  });

  // AI Route 5: Lyria Music Generation (lyria-3-clip-preview | lyria-3-pro-preview)
  app.post('/api/ai/generate-music', async (req, res) => {
    try {
      const { prompt, model, imageBase64, imageMimeType } = req.body ?? {};
      if (typeof prompt !== 'string' || prompt.trim().length < 3) {
        return res.status(400).json({ error: 'Veuillez décrire l\'ambiance musicale souhaitée.' });
      }

      const selectedModel =
        model === 'lyria-3-pro-preview' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview';

      const ai = getAiClient();
      if (!ai) {
        return res.status(503).json({
          error: 'Studio musical non configuré. Vérifiez GEMINI_API_KEY dans Settings > Secrets.',
        });
      }

      const contents =
        typeof imageBase64 === 'string' && imageBase64.length > 0
          ? {
              parts: [
                { text: prompt.trim().slice(0, 500) },
                {
                  inlineData: {
                    data: imageBase64,
                    mimeType:
                      typeof imageMimeType === 'string' && imageMimeType.startsWith('image/')
                        ? imageMimeType
                        : 'image/jpeg',
                  },
                },
              ],
            }
          : prompt.trim().slice(0, 500);

      const response = await ai.models.generateContentStream({
        model: selectedModel,
        contents,
      });

      const audioChunks: Buffer[] = [];
      let lyrics = '';
      let mimeType = 'audio/mpeg';

      for await (const chunk of response) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (audioChunks.length === 0 && part.inlineData.mimeType) {
              mimeType = part.inlineData.mimeType;
            }
            audioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
          }
          if (part.text) {
            lyrics += part.text;
          }
        }
      }

      if (audioChunks.length === 0) {
        return res.status(502).json({
          error: 'Aucun flux audio renvoyé par le modèle musical.',
        });
      }

      const audioBase64 = Buffer.concat(audioChunks).toString('base64');
      return res.json({
        model: selectedModel,
        mimeType,
        lyrics: lyrics.trim(),
        audioDataUrl: `data:${mimeType};base64,${audioBase64}`,
      });
    } catch (err) {
      const info = classifyGeminiError(err);
      return res.status(info.status).json({ error: info.message });
    }
  });

  // Protected Cloud SQL Relational Workspace Routes (Firebase Auth Bearer required)
  app.get('/api/sql/workspace', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const email = req.user!.email || 'utilisateur@chronosphere.app';
      const displayName = typeof req.user!.name === 'string' ? req.user!.name : undefined;
      const sqlUser = await getOrCreateUser(uid, email, displayName);
      const eventId =
        typeof req.query.eventId === 'string' ? req.query.eventId.slice(0, 128) : undefined;
      const data = await getUserEventSqlWorkspace(sqlUser.id, eventId);
      return res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur de chargement.';
      return res.status(500).json({ error: msg });
    }
  });

  app.post('/api/sql/soundtracks', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { eventId, eventTitle, model, prompt, lyrics, mimeType, audioDataUrl } = req.body ?? {};
      if (
        typeof eventId !== 'string' ||
        typeof eventTitle !== 'string' ||
        typeof model !== 'string' ||
        typeof prompt !== 'string' ||
        typeof audioDataUrl !== 'string' ||
        !audioDataUrl.startsWith('data:audio/')
      ) {
        return res.status(400).json({ error: 'Données de piste audio invalides.' });
      }
      const sqlUser = await getOrCreateUser(
        req.user!.uid,
        req.user!.email || '',
        typeof req.user!.name === 'string' ? req.user!.name : undefined
      );
      const saved = await saveSqlSoundtrack({
        userId: sqlUser.id,
        eventId: eventId.slice(0, 128),
        eventTitle: eventTitle.slice(0, 120),
        model: model.slice(0, 64),
        prompt: prompt.slice(0, 500),
        lyrics: typeof lyrics === 'string' ? lyrics.slice(0, 4000) : undefined,
        mimeType: typeof mimeType === 'string' ? mimeType.slice(0, 40) : 'audio/mpeg',
        audioDataUrl,
      });
      return res.status(201).json(saved);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sauvegarde impossible.';
      return res.status(500).json({ error: msg });
    }
  });

  app.delete('/api/sql/soundtracks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Identifiant invalide.' });
      }
      const sqlUser = await getOrCreateUser(req.user!.uid, req.user!.email || '');
      const deleted = await deleteSqlSoundtrack(sqlUser.id, id);
      if (!deleted) {
        return res.status(404).json({ error: 'Piste introuvable.' });
      }
      return res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Suppression impossible.';
      return res.status(500).json({ error: msg });
    }
  });

  app.post('/api/sql/research', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { eventId, sourceType, query, summary, links } = req.body ?? {};
      const validTypes = ['maps_grounding', 'search_grounding', 'live_voice'];
      if (
        typeof eventId !== 'string' ||
        !validTypes.includes(sourceType) ||
        typeof query !== 'string' ||
        typeof summary !== 'string'
      ) {
        return res.status(400).json({ error: 'Données de note invalides.' });
      }
      const safeLinks = Array.isArray(links)
        ? links
            .filter(
              (l) =>
                l &&
                typeof l.uri === 'string' &&
                (l.uri.startsWith('https://') || l.uri.startsWith('http://'))
            )
            .slice(0, 20)
            .map((l) => ({
              title: typeof l.title === 'string' ? l.title.slice(0, 140) : l.uri,
              uri: l.uri,
            }))
        : [];

      const sqlUser = await getOrCreateUser(
        req.user!.uid,
        req.user!.email || '',
        typeof req.user!.name === 'string' ? req.user!.name : undefined
      );
      const saved = await saveSqlResearchNote({
        userId: sqlUser.id,
        eventId: eventId.slice(0, 128),
        sourceType,
        query: query.slice(0, 400),
        summary: summary.slice(0, 6000),
        links: safeLinks,
      });
      return res.status(201).json(saved);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sauvegarde impossible.';
      return res.status(500).json({ error: msg });
    }
  });

  app.delete('/api/sql/research/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Identifiant invalide.' });
      }
      const sqlUser = await getOrCreateUser(req.user!.uid, req.user!.email || '');
      const deleted = await deleteSqlResearchNote(sqlUser.id, id);
      if (!deleted) {
        return res.status(404).json({ error: 'Note introuvable.' });
      }
      return res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Suppression impossible.';
      return res.status(500).json({ error: msg });
    }
  });

  app.post('/api/sql/activity', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { eventId, actionType, details } = req.body ?? {};
      if (
        typeof eventId !== 'string' ||
        typeof actionType !== 'string' ||
        typeof details !== 'string'
      ) {
        return res.status(400).json({ error: 'Paramètres d\'activité invalides.' });
      }
      const sqlUser = await getOrCreateUser(req.user!.uid, req.user!.email || '');
      const logged = await logSqlActivity({
        userId: sqlUser.id,
        eventId: eventId.slice(0, 128),
        actionType: actionType.slice(0, 48),
        details: details.slice(0, 300),
      });
      return res.status(201).json(logged);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Enregistrement impossible.';
      return res.status(500).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server },
        hmr: process.env.DISABLE_HMR === 'true' ? false : true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ChronoSphere server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
