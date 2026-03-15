'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';

/**
 * F13 — Voice Recorder
 * Records audio via MediaRecorder API → WebM/Opus.
 * Shows recording timer, waveform preview, send/cancel buttons.
 *
 * Desktop fix: getUserMedia permission prompt caused a "blink" because
 * the component would mount → request permission → fail → unmount instantly.
 * Now shows a "Requesting mic…" state and handles errors gracefully.
 */

interface VoiceRecorderProps {
  onSend: (blob: Blob, durationMs: number) => void;
  onCancel: () => void;
}

type RecorderState = 'requesting' | 'recording' | 'error';

export function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const [state, setState] = useState<RecorderState>('requesting');
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mountedRef = useRef(true);

  const cleanup = useCallback(() => {
    clearInterval(timerRef.current);
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (mediaRecorderRef.current?.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null;
    analyserRef.current = null;
    if (audioCtxRef.current?.state !== 'closed') {
      try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    }
    audioCtxRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    // Check API availability
    if (!navigator.mediaDevices?.getUserMedia) {
      if (mountedRef.current) {
        setErrorMsg('Microphone not available (requires HTTPS)');
        setState('error');
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 48000,
        },
      });

      // Component may have unmounted during permission prompt
      if (!mountedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;

      // Audio analysis for visual feedback
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Start level monitoring
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const monitorLevel = () => {
        if (!mountedRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(avg / 255);
        animFrameRef.current = requestAnimationFrame(monitorLevel);
      };
      monitorLevel();

      // MediaRecorder — prefer webm/opus, fallback to mp4 (Safari)
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/mp4';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        // Let browser choose
        mimeType = '';
      }

      const recorderOptions: MediaRecorderOptions = {
        audioBitsPerSecond: 32000,
      };
      if (mimeType) recorderOptions.mimeType = mimeType;

      const recorder = new MediaRecorder(stream, recorderOptions);

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      // Handle unexpected stops (e.g. track ended)
      recorder.onerror = () => {
        if (mountedRef.current) {
          setErrorMsg('Recording error');
          setState('error');
          cleanup();
        }
      };

      recorder.start(100); // Collect data every 100ms
      mediaRecorderRef.current = recorder;
      startTimeRef.current = Date.now();
      setState('recording');
      setDuration(0);

      timerRef.current = setInterval(() => {
        if (mountedRef.current) {
          setDuration(Date.now() - startTimeRef.current);
        }
      }, 100);
    } catch (err) {
      console.error('Microphone access denied:', err);
      if (mountedRef.current) {
        const msg = err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission denied'
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? 'No microphone found'
            : 'Could not access microphone';
        setErrorMsg(msg);
        setState('error');
      }
    }
  }, [cleanup]);

  const stopAndSend = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      const durationMs = Date.now() - startTimeRef.current;
      cleanup();
      onSend(blob, durationMs);
    };
    recorder.stop();
  }, [onSend, cleanup]);

  const cancel = useCallback(() => {
    cleanup();
    onCancel();
  }, [onCancel, cleanup]);

  // Auto-start on mount
  useEffect(() => {
    mountedRef.current = true;
    startRecording();
    return () => {
      mountedRef.current = false;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Error state
  if (state === 'error') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
      }}>
        <span style={{ fontSize: 16 }}>⚠️</span>
        <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>
          {errorMsg}
        </span>
        <button
          onClick={cancel}
          style={{
            padding: '6px 14px', borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-hover)', border: '1px solid var(--border)',
            color: 'var(--text)', fontSize: 12, cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    );
  }

  // Requesting permission state
  if (state === 'requesting') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
      }}>
        <span style={{ fontSize: 16, animation: 'pulse 1.5s infinite' }}>🎙️</span>
        <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>
          Requesting microphone access…
        </span>
        <button
          onClick={cancel}
          style={{
            padding: '6px 14px', borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-hover)', border: '1px solid var(--border)',
            color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  // Waveform bars
  const bars = 24;
  const barHeights = Array.from({ length: bars }, (_, i) => {
    const base = Math.sin(i * 0.5 + duration * 0.003) * 0.3 + 0.2;
    return Math.min(1, base + audioLevel * 0.8);
  });

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 16px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
    }}>
      {/* Cancel */}
      <button
        onClick={cancel}
        aria-label="Cancel recording"
        style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'rgba(248,81,73,0.15)', border: 'none',
          color: 'var(--red, #F85149)', fontSize: 18,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        ✕
      </button>

      {/* Recording indicator dot */}
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: '#F85149',
        animation: 'pulse 1s infinite',
        flexShrink: 0,
      }} />

      {/* Timer */}
      <span style={{
        fontSize: 14, fontFamily: 'var(--font-mono)',
        color: 'var(--red, #F85149)',
        minWidth: 40, flexShrink: 0,
      }}>
        {formatDuration(duration)}
      </span>

      {/* Waveform */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 2,
        height: 32, overflow: 'hidden',
      }}>
        {barHeights.map((h, i) => (
          <div key={i} style={{
            width: 3, borderRadius: 2, flexShrink: 0,
            height: `${Math.max(4, h * 28)}px`,
            background: 'var(--coral)',
            transition: 'height 100ms',
          }} />
        ))}
      </div>

      {/* Send */}
      <button
        onClick={stopAndSend}
        aria-label="Send voice message"
        style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'var(--coral)', border: 'none',
          color: '#fff', fontSize: 18,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(245,158,11,0.3)',
          flexShrink: 0,
        }}
      >
        ↑
      </button>
    </div>
  );
}
