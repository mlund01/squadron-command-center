import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { singleLine } from '@/lib/utils';

// Subscribes to /human-inputs/stream for the current instance and
// fires a toast + chime when a new request arrives, unless the
// operator is already on the Inbox.
//
// Browser notifications were intentionally left out — too inconsistent
// across OS / browser combinations to depend on; the toast and chime
// are the reliable in-app channels.
export function useHumanInputAlerts(instanceId: string | undefined) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const onInboxRef = useRef(false);
  const navigateRef = useRef(navigate);
  useEffect(() => {
    onInboxRef.current = location.pathname.endsWith('/inbox');
    navigateRef.current = navigate;
  });

  // Safari (and increasingly Chrome) won't play audio until the user
  // has interacted with the page. We arm a one-shot listener on the
  // first interaction to unlock the AudioContext.
  useEffect(() => {
    primeAudio();
    return registerTestAlert();
  }, []);

  useEffect(() => {
    if (!instanceId) return;
    const url = `/api/instances/${encodeURIComponent(instanceId)}/human-inputs/stream`;
    const es = new EventSource(url);

    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: ['humanInputs', instanceId] });

    const handleCreated = (e: MessageEvent) => {
      const payload = parseEvent(e);
      if (!payload) return;
      invalidate();
      if (onInboxRef.current) return;
      fireAlerts(payload, () => navigateRef.current(`/instances/${instanceId}/inbox`));
    };

    const handleResolved = () => invalidate();

    es.addEventListener('human_input_requested', handleCreated);
    es.addEventListener('human_input_resolved', handleResolved);
    es.onerror = () => {
      // EventSource auto-reconnects.
      // eslint-disable-next-line no-console
      console.info('[human-input-alerts] SSE disconnected, will auto-retry');
    };

    return () => {
      es.close();
    };
  }, [instanceId, queryClient]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Event payload → alert
// ─────────────────────────────────────────────────────────────────────────────

interface HumanInputRequestedData {
  taskName?: string;
  agentName?: string;
  toolCallId: string;
  question: string;
  shortSummary?: string;
  additionalContext?: string;
  choices?: string[];
}

interface MissionEventEnvelope {
  missionId?: string;
  eventType: string;
  data: HumanInputRequestedData;
}

function parseEvent(e: MessageEvent): HumanInputRequestedData | null {
  try {
    const env = JSON.parse(e.data) as MissionEventEnvelope;
    return env.data ?? null;
  } catch {
    return null;
  }
}

function fireAlerts(data: HumanInputRequestedData, openInbox: () => void) {
  const title = data.shortSummary || singleLine(data.question, 160);
  const subtitle = taskLine(data);
  toast(title, {
    description: subtitle,
    action: { label: 'Open inbox', onClick: openInbox },
  });
  // Always chime — focus state is unreliable signal for "is the
  // operator paying attention" (could be on a different commander
  // page, talking on a call, etc). The Inbox-page short-circuit
  // upstream already handles the "user is actively responding" case.
  beep();
}

function taskLine(data: HumanInputRequestedData): string | undefined {
  if (data.taskName && data.agentName) return `${data.taskName} · ${data.agentName}`;
  return data.taskName ?? data.agentName;
}

// ─────────────────────────────────────────────────────────────────────────────
// DevTools helper
// ─────────────────────────────────────────────────────────────────────────────

// registerTestAlert exposes a synthetic-alert helper on `window` so we
// can tune the chime/toast from DevTools without running a mission.
// Returns a teardown that removes it on unmount so layout remounts
// don't leak a stale closure.
function registerTestAlert(): () => void {
  type WithTestAlert = { __squadronTestAlert?: () => void };
  const w = window as unknown as WithTestAlert;
  if (w.__squadronTestAlert) return () => undefined;

  w.__squadronTestAlert = () => {
    fireAlerts(
      {
        toolCallId: `test-${Date.now()}`,
        question: 'This is a test alert fired from DevTools.',
        shortSummary: 'Test alert',
        taskName: 'test',
      },
      () => undefined,
    );
  };

  return () => {
    delete w.__squadronTestAlert;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Chime — preloaded sonar-ping mp3 played via Web Audio with a
// shortened envelope (Web Audio over <audio> so we can shape gain).
// ─────────────────────────────────────────────────────────────────────────────

const CHIME_URL = '/sonar-ping.mp3';
// Source has a long reverb tail; cap the playback to a snappy alert.
const CHIME_MAX_DURATION = 1.0;
const CHIME_FADE = 0.03;
const CHIME_GAIN = 1.0;

let audioCtx: AudioContext | null = null;
let audioPrimed = false;
let chimeBuffer: AudioBuffer | null = null;
let chimeLoad: Promise<AudioBuffer | null> | null = null;
// Fallback HTMLAudioElement. Web Audio is preferred (we get the
// snappy gain envelope) but background tabs / hidden-document state
// can suspend AudioContext in ways that are hard to recover from
// without a user gesture. <audio>.play() survives that better, so we
// keep one primed alongside the Web Audio path.
let chimeEl: HTMLAudioElement | null = null;

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext || w.webkitAudioContext || null;
}

function ensureAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx;
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

function loadChime(ctx: AudioContext): Promise<AudioBuffer | null> {
  if (chimeBuffer) return Promise.resolve(chimeBuffer);
  if (chimeLoad) return chimeLoad;
  chimeLoad = (async () => {
    try {
      const res = await fetch(CHIME_URL);
      if (!res.ok) throw new Error(`fetch ${CHIME_URL}: ${res.status}`);
      const arr = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(arr);
      chimeBuffer = buf;
      return buf;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[human-input-alerts] failed to load chime', err);
      return null;
    } finally {
      chimeLoad = null;
    }
  })();
  return chimeLoad;
}

// primeAudio waits for the first user interaction, then unlocks the
// AudioContext (Safari quirk: needs an explicit resume + a real
// source playing to completion before later sources are audible) and
// kicks off the chime fetch.
function primeAudio() {
  if (audioPrimed) return;
  if (typeof window === 'undefined') return;

  const unlock = () => {
    cleanup();
    const ctx = ensureAudioContext();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') void ctx.resume();
      const silent = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = silent;
      src.connect(ctx.destination);
      src.start(0);
      audioPrimed = true;
      void loadChime(ctx);
    } catch {
      /* best-effort */
    }
    // Prime the HTMLAudio fallback during the same user-gesture so it
    // can play later without one. Calling load() inside the gesture is
    // enough on most browsers; some need an actual play() to fully
    // unlock, so we play() and immediately pause() at zero volume.
    try {
      const el = new Audio(CHIME_URL);
      el.preload = 'auto';
      el.volume = 0;
      const p = el.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          el.pause();
          el.currentTime = 0;
          el.volume = CHIME_GAIN;
        }).catch(() => {
          // Some browsers reject; that's fine — the Web Audio path is primary.
        });
      }
      chimeEl = el;
    } catch {
      /* best-effort */
    }
  };

  const cleanup = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };

  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchstart', unlock);
}

function beep() {
  // HTMLAudio fallback first when the document is hidden/backgrounded.
  // Web Audio scheduling against a suspended AudioContext can produce
  // no audible output even after resume() resolves; <audio>.play() is
  // less precise but more reliable in throttled tabs.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    if (playChimeEl()) return;
  }

  const ctx = ensureAudioContext();
  if (!ctx) {
    void playChimeEl();
    return;
  }

  const tryPlay = (buf: AudioBuffer) => {
    if (ctx.state === 'suspended') {
      // Await the resume so we schedule against an actually-advancing
      // currentTime rather than a frozen one.
      ctx.resume().then(() => playChime(ctx, buf)).catch(() => playChimeEl());
      return;
    }
    playChime(ctx, buf);
  };

  if (chimeBuffer) {
    tryPlay(chimeBuffer);
    return;
  }
  void loadChime(ctx).then((buf) => {
    if (buf) tryPlay(buf);
    else void playChimeEl();
  });
}

// playChimeEl plays the HTMLAudio fallback. Returns true if playback
// was kicked off. Safe to call repeatedly — we rewind to start so
// rapid alerts don't queue or stall.
function playChimeEl(): boolean {
  if (!chimeEl) return false;
  try {
    chimeEl.currentTime = 0;
    chimeEl.volume = CHIME_GAIN;
    const p = chimeEl.play();
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

function playChime(ctx: AudioContext, buf: AudioBuffer) {
  try {
    const start = ctx.currentTime;
    const playLen = Math.min(CHIME_MAX_DURATION, buf.duration);
    const fadeStart = start + Math.max(0, playLen - CHIME_FADE);
    const fadeEnd = start + playLen;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(CHIME_GAIN, start);
    gain.gain.setValueAtTime(CHIME_GAIN, fadeStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, fadeEnd);

    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(start);
    src.stop(fadeEnd);
  } catch {
    /* ignore */
  }
}
