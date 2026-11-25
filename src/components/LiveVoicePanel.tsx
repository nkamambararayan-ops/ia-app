import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Save, Send, Volume2 } from 'lucide-react';
import { CountdownEvent } from '../types';
import { formatFrenchDateTime } from '../lib/time';

type LiveVoiceName = 'Zephyr' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir';

interface TranscriptEntry {
  id: string;
  speaker: 'Vous' | 'Assistant';
  text: string;
}

interface LiveVoicePanelProps {
  event: CountdownEvent;
  isAuthenticated: boolean;
  onSaveTranscriptSummary: (summary: string) => Promise<void>;
}

function pcmFloat32ToBase64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToPcmFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export const LiveVoicePanel: React.FC<LiveVoicePanelProps> = ({
  event,
  isAuthenticated,
  onSaveTranscriptSummary,
}) => {
  const [voiceName, setVoiceName] = useState<LiveVoiceName>('Zephyr');
  const [sessionState, setSessionState] = useState<'idle' | 'connecting' | 'live'>('idle');
  const [micMuted, setMicMuted] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micMutedRef = useRef(false);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  useEffect(() => {
    micMutedRef.current = micMuted;
  }, [micMuted]);

  const stopPlaybackQueue = () => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // Ignore already stopped
      }
    }
    activeSourcesRef.current = [];
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
  };

  const cleanupSession = () => {
    stopPlaybackQueue();
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (inputCtxRef.current) {
      void inputCtxRef.current.close();
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      void outputCtxRef.current.close();
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setSessionState('idle');
  };

  useEffect(() => {
    return () => {
      cleanupSession();
    };
  }, []);

  const scheduleAudioChunk = (base64Audio: string) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;

    const samples = base64ToPcmFloat32(base64Audio);
    const audioBuffer = ctx.createBuffer(1, samples.length, 24000);
    audioBuffer.getChannelData(0).set(samples);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + 0.02, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + audioBuffer.duration;
    activeSourcesRef.current.push(source);
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
    };
  };

  const appendTranscript = (speaker: 'Vous' | 'Assistant', chunk: string) => {
    const clean = chunk.trim();
    if (!clean) return;
    setTranscripts((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.speaker === speaker) {
        return [
          ...prev.slice(0, -1),
          { ...last, text: `${last.text} ${clean}`.trim() },
        ];
      }
      return [
        ...prev,
        { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, speaker, text: clean },
      ];
    });
  };

  const startLiveSession = async () => {
    setError(null);
    setSessionState('connecting');

    try {
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/live`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'start',
            voiceName,
            eventTitle: event.title,
            eventDate: formatFrenchDateTime(event.targetIso),
            eventLocation: event.locationAddress || event.locationName || '',
          })
        );
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.ready) {
            setSessionState('live');
          }
          if (msg.error) {
            setError(String(msg.error));
            cleanupSession();
          }
          if (msg.audio) {
            scheduleAudioChunk(msg.audio);
          }
          if (msg.interrupted) {
            stopPlaybackQueue();
          }
          if (msg.inputTranscript) {
            appendTranscript('Vous', String(msg.inputTranscript));
          }
          if (msg.outputTranscript) {
            appendTranscript('Assistant', String(msg.outputTranscript));
          }
        } catch {
          // Ignore malformed JSON
        }
      };

      ws.onerror = () => {
        setError('Connexion vocale interrompue.');
        cleanupSession();
      };

      ws.onclose = () => {
        setSessionState('idle');
      };

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      source.connect(processor);
      processor.connect(inputCtx.destination);

      processor.onaudioprocess = (e) => {
        if (micMutedRef.current) return;
        const activeWs = wsRef.current;
        if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
        const base64 = pcmFloat32ToBase64(e.inputBuffer.getChannelData(0));
        activeWs.send(JSON.stringify({ type: 'audio', audio: base64 }));
      };
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossible d'accéder au microphone ou au service vocal."
      );
      cleanupSession();
    }
  };

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = textInput.trim();
    if (!clean || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'text', text: clean }));
    appendTranscript('Vous', clean);
    setTextInput('');
  };

  const handleSaveNotes = async () => {
    if (transcripts.length === 0) return;
    setSaving(true);
    try {
      const formatted = transcripts
        .map((t) => `${t.speaker} : ${t.text}`)
        .join('\n');
      await onSaveTranscriptSummary(formatted);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Conversation vocale en direct
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Discutez par la voix en temps réel avec l'assistant sur l'événement « {event.title} ».
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={voiceName}
            disabled={sessionState !== 'idle'}
            onChange={(e) => setVoiceName(e.target.value as LiveVoiceName)}
            className="ios-input px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 disabled:opacity-60"
          >
            <option value="Zephyr">Voix Zephyr</option>
            <option value="Puck">Voix Puck</option>
            <option value="Charon">Voix Charon</option>
            <option value="Kore">Voix Kore</option>
            <option value="Fenrir">Voix Fenrir</option>
          </select>

          {sessionState === 'idle' ? (
            <button
              type="button"
              onClick={() => void startLiveSession()}
              className="ios-btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs whitespace-nowrap"
            >
              <Mic className="w-3.5 h-3.5" />
              Démarrer l'échange vocal
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setMicMuted((m) => !m)}
                className={`inline-flex items-center gap-1.5 rounded-[14px] border px-3 py-2 text-xs font-medium whitespace-nowrap ios-press ${
                  micMuted
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                    : 'ios-btn-secondary text-slate-700 dark:text-slate-200'
                }`}
              >
                {micMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                {micMuted ? 'Micro coupé' : 'Micro actif'}
              </button>
              <button
                type="button"
                onClick={cleanupSession}
                className="inline-flex items-center gap-1.5 rounded-[14px] bg-rose-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-rose-700 whitespace-nowrap ios-press"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                Terminer
              </button>
            </>
          )}
        </div>
      </div>

      {sessionState !== 'idle' && (
        <div className="rounded-[18px] border border-emerald-500/25 bg-emerald-500/10 backdrop-blur-xl px-4 py-3 flex items-center justify-between text-xs text-emerald-900 dark:text-emerald-200">
          <div className="flex items-center gap-2 font-medium">
            <Volume2 className="w-4 h-4 shrink-0" />
            <span>
              {sessionState === 'connecting'
                ? 'Connexion au canal audio en cours...'
                : 'Session vocale active — parlez naturellement ou envoyez un message.'}
            </span>
          </div>
          <span className="font-mono">16 kHz / 24 kHz</span>
        </div>
      )}

      {error && (
        <div className="rounded-[14px] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {sessionState === 'live' && (
        <form onSubmit={handleSendText} className="flex gap-2">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Envoyer une précision écrite pendant l'appel..."
            className="ios-input flex-1 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={!textInput.trim()}
            className="ios-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs disabled:opacity-50 whitespace-nowrap"
          >
            <Send className="w-3.5 h-3.5" />
            Envoyer
          </button>
        </form>
      )}

      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            Transcription en direct
          </span>
          {isAuthenticated && transcripts.length > 0 && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSaveNotes()}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#007AFF] dark:text-[#0A84FF] hover:underline disabled:opacity-50 ios-press"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Enregistrement...' : 'Archiver la discussion'}
            </button>
          )}
        </div>

        <div className="ios-glass-subtle rounded-[20px] p-4 max-h-64 overflow-y-auto space-y-2.5">
          {transcripts.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-4">
              Démarrez l'échange vocal pour poser vos questions sur le programme, la logistique ou les rappels de cet événement.
            </p>
          ) : (
            transcripts.map((entry) => (
              <div
                key={entry.id}
                className={`rounded-[16px] px-3.5 py-2.5 text-sm ${
                  entry.speaker === 'Vous'
                    ? 'bg-white/75 dark:bg-white/[0.06] border border-slate-900/[0.06] dark:border-white/[0.08]'
                    : 'bg-[#007AFF]/[0.08] dark:bg-[#0A84FF]/15 border border-[#007AFF]/20'
                }`}
              >
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5">
                  {entry.speaker}
                </div>
                <div className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                  {entry.text}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
