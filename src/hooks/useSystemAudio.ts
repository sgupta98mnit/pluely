import { useEffect, useState, useCallback, useRef } from "react";
import { useWindowResize, useGlobalShortcuts, useMicContext } from ".";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "@/contexts";
import { fetchSTT, fetchAIResponse } from "@/lib/functions";
import {
  DEFAULT_QUICK_ACTIONS,
  DEFAULT_SYSTEM_PROMPT,
  STORAGE_KEYS,
} from "@/config";
import {
  safeLocalStorage,
  shouldUsePluelyAPI,
  generateConversationTitle,
  saveConversation,
  CONVERSATION_SAVE_DEBOUNCE_MS,
  generateConversationId,
  generateMessageId,
} from "@/lib";
import { isMeaningfulTranscription } from "@/lib/utils";
import { Message } from "@/types/completion";

// VAD Configuration interface matching Rust
export interface VadConfig {
  enabled: boolean;
  hop_size: number;
  sensitivity_rms: number;
  peak_threshold: number;
  silence_chunks: number;
  min_speech_chunks: number;
  pre_speech_chunks: number;
  noise_gate_threshold: number;
  max_recording_duration_secs: number;
  /** Live transcript preview while the speaker is still talking (extra STT calls). */
  partial_transcripts: boolean;
  /** Seconds between partial transcript updates. */
  partial_interval_secs: number;
  /** Auto-raise detection thresholds to the room's measured noise floor. */
  auto_calibrate: boolean;
}

/** Frontend-only behavior settings for system-audio sessions. */
export interface BehaviorSettings {
  /**
   * When a new speech segment arrives shortly after the previous answer, treat
   * it as a continuation of the same question: drop the half answer, combine
   * the transcripts, and re-ask once.
   */
  mergeContinuation: boolean;
  /** Also transcribe the user's own mic as "[You]: ..." context messages. */
  micContext: boolean;
}

const DEFAULT_BEHAVIOR: BehaviorSettings = {
  mergeContinuation: true,
  micContext: false,
};

const BEHAVIOR_STORAGE_KEY = "system_audio_behavior";

/** A continuation must arrive within this window to merge with the last turn. */
const MERGE_WINDOW_MS = 4000;

// OPTIMIZED VAD defaults - matches backend exactly for perfect performance
const DEFAULT_VAD_CONFIG: VadConfig = {
  enabled: true,
  hop_size: 1024,
  sensitivity_rms: 0.012, // Much less sensitive - only real speech
  peak_threshold: 0.035, // Higher threshold - filters clicks/noise
  silence_chunks: 70, // ~1.5s of required silence - survives mid-question pauses
  min_speech_chunks: 7, // ~0.16s - captures short answers
  pre_speech_chunks: 18, // ~0.4s - wider pre-roll so soft/fast word starts aren't clipped
  noise_gate_threshold: 0.003, // Stronger noise filtering
  max_recording_duration_secs: 180, // 3 minutes default
  partial_transcripts: false, // Off by default - each partial is an STT call
  partial_interval_secs: 3,
  auto_calibrate: true,
};

// Chat message interface (reusing from useCompletion)
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

// Conversation interface (reusing from useCompletion)
export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export type useSystemAudioType = ReturnType<typeof useSystemAudio>;

export function useSystemAudio() {
  const { resizeWindow } = useWindowResize();
  const globalShortcuts = useGlobalShortcuts();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [lastTranscription, setLastTranscription] = useState<string>("");
  const [lastAIResponse, setLastAIResponse] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const [quickActions, setQuickActions] = useState<string[]>([]);
  const [isManagingQuickActions, setIsManagingQuickActions] =
    useState<boolean>(false);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(true);
  const [vadConfig, setVadConfig] = useState<VadConfig>(DEFAULT_VAD_CONFIG);
  const [recordingProgress, setRecordingProgress] = useState<number>(0); // For continuous mode
  const [isContinuousMode, setIsContinuousMode] = useState<boolean>(false);
  const [isRecordingInContinuousMode, setIsRecordingInContinuousMode] =
    useState<boolean>(false);

  const [conversation, setConversation] = useState<ChatConversation>({
    id: "",
    title: "",
    messages: [],
    createdAt: 0,
    updatedAt: 0,
  });

  // Context management states
  const [useSystemPrompt, setUseSystemPrompt] = useState<boolean>(true);
  const [contextContent, setContextContent] = useState<string>("");

  // Live transcript preview (populated only when partial_transcripts is on)
  const [partialTranscript, setPartialTranscript] = useState<string>("");

  // Behavior settings (merge-on-continuation, mic context)
  const [behavior, setBehavior] = useState<BehaviorSettings>(DEFAULT_BEHAVIOR);

  const updateBehavior = useCallback((update: Partial<BehaviorSettings>) => {
    setBehavior((prev) => {
      const next = { ...prev, ...update };
      safeLocalStorage.setItem(BEHAVIOR_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const {
    selectedSttProvider,
    allSttProviders,
    selectedAIProvider,
    allAiProviders,
    systemPrompt,
    selectedAudioDevices,
    contextText,
  } = useApp();
  const abortControllerRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Load context settings and VAD config from localStorage on mount
  useEffect(() => {
    const savedContext = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT
    );
    if (savedContext) {
      try {
        const parsed = JSON.parse(savedContext);
        setUseSystemPrompt(parsed.useSystemPrompt ?? true);
        setContextContent(parsed.contextContent ?? "");
      } catch (error) {
        console.error("Failed to load system audio context:", error);
      }
    }

    // Load VAD config. v2 key: v1's default silence hold (~1s) cut questions
    // in half whenever the speaker paused to think, so migrate old saved
    // configs up to a safe minimum once.
    try {
      const savedV2 = safeLocalStorage.getItem("vad_config_v2");
      if (savedV2) {
        // Spread over defaults so configs saved before new fields existed
        // still get sensible values.
        setVadConfig({ ...DEFAULT_VAD_CONFIG, ...JSON.parse(savedV2) });
      } else {
        const legacy = safeLocalStorage.getItem("vad_config");
        if (legacy) {
          const parsed = JSON.parse(legacy);
          const migrated = {
            ...DEFAULT_VAD_CONFIG,
            ...parsed,
            silence_chunks: Math.max(parsed.silence_chunks ?? 70, 60),
          };
          setVadConfig(migrated);
          safeLocalStorage.setItem("vad_config_v2", JSON.stringify(migrated));
        }
      }
    } catch (error) {
      console.error("Failed to load VAD config:", error);
    }

    // Load behavior settings
    try {
      const savedBehavior = safeLocalStorage.getItem(BEHAVIOR_STORAGE_KEY);
      if (savedBehavior) {
        setBehavior({ ...DEFAULT_BEHAVIOR, ...JSON.parse(savedBehavior) });
      }
    } catch (error) {
      console.error("Failed to load behavior settings:", error);
    }
  }, []);

  // Load quick actions from localStorage on mount
  useEffect(() => {
    const savedActions = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS
    );
    if (savedActions) {
      try {
        const parsed = JSON.parse(savedActions);
        setQuickActions(parsed);
      } catch (error) {
        console.error("Failed to load quick actions:", error);
        setQuickActions(DEFAULT_QUICK_ACTIONS);
      }
    } else {
      setQuickActions(DEFAULT_QUICK_ACTIONS);
    }
  }, []);

  // Handle continuous recording progress events AND error events
  useEffect(() => {
    let progressUnlisten: (() => void) | undefined;
    let startUnlisten: (() => void) | undefined;
    let stopUnlisten: (() => void) | undefined;
    let errorUnlisten: (() => void) | undefined;
    let discardedUnlisten: (() => void) | undefined;

    const setupContinuousListeners = async () => {
      try {
        // Progress updates (every second)
        progressUnlisten = await listen("recording-progress", (event) => {
          const seconds = event.payload as number;
          setRecordingProgress(seconds);
        });

        // Recording started
        startUnlisten = await listen("continuous-recording-start", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(true);
        });

        // Recording stopped
        stopUnlisten = await listen("continuous-recording-stopped", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(false);
        });

        // Audio encoding errors
        errorUnlisten = await listen("audio-encoding-error", (event) => {
          const errorMsg = event.payload as string;
          console.error("Audio encoding error:", errorMsg);
          setError(`Failed to process audio: ${errorMsg}`);
          setIsProcessing(false);
          setIsAIProcessing(false);
          setIsRecordingInContinuousMode(false);
        });

        // Speech discarded (too short)
        discardedUnlisten = await listen("speech-discarded", (event) => {
          const reason = event.payload as string;
          console.log("Speech discarded:", reason);
          // Don't show error - this is expected behavior
        });
      } catch (err) {
        console.error("Failed to setup continuous recording listeners:", err);
      }
    };

    setupContinuousListeners();

    return () => {
      if (progressUnlisten) progressUnlisten();
      if (startUnlisten) startUnlisten();
      if (stopUnlisten) stopUnlisten();
      if (errorUnlisten) errorUnlisten();
      if (discardedUnlisten) discardedUnlisten();
    };
  }, []);

  // Latest-value refs, so the speech listener can be registered exactly once.
  // The old effect re-subscribed on every new message; speech segments
  // arriving in the unlisten/relisten gap were silently dropped, which is one
  // way only "half" of what was said produced an answer.
  const capturingRef = useRef(capturing);
  const conversationRef = useRef(conversation);
  const vadConfigRef = useRef(vadConfig);
  const behaviorRef = useRef(behavior);
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());
  const handleSpeechSegmentRef = useRef<(b64: string) => Promise<void>>(
    async () => {}
  );
  const handlePartialSegmentRef = useRef<(b64: string) => Promise<void>>(
    async () => {}
  );

  // The last completed Q&A turn, so a quick follow-up segment can be merged
  // into it (question split across a pause -> one combined re-ask).
  const lastTurnRef = useRef<{
    question: string;
    userMsgId: string;
    assistantMsgId: string;
    completedAt: number;
  } | null>(null);

  // Partial-transcript bookkeeping: generation guard invalidates in-flight
  // partials once the final segment lands; busy flag drops (rather than
  // queues) partials while one is already transcribing.
  const partialGenRef = useRef(0);
  const partialBusyRef = useRef(false);

  useEffect(() => {
    capturingRef.current = capturing;
  }, [capturing]);

  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  useEffect(() => {
    vadConfigRef.current = vadConfig;
  }, [vadConfig]);

  useEffect(() => {
    behaviorRef.current = behavior;
  }, [behavior]);

  // Reassigned after every render (effect with no dep array) so the queue
  // always runs the freshest closure (current providers, prompts,
  // conversation) - no stale state, and no TDZ issue with processWithAI
  // which is declared further down.
  useEffect(() => {
    handleSpeechSegmentRef.current = handleSpeechSegment;
    handlePartialSegmentRef.current = handlePartialSegment;
  });

  const base64ToWavBlob = (base64Audio: string): Blob => {
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: "audio/wav" });
  };

  // Live transcript preview: transcribe the in-progress buffer. Latest-wins;
  // results are discarded if a final segment has since arrived.
  const handlePartialSegment = async (base64Audio: string) => {
    if (partialBusyRef.current) return;
    partialBusyRef.current = true;
    const generation = partialGenRef.current;

    try {
      const usePluelyAPI = await shouldUsePluelyAPI();
      const providerConfig = allSttProviders.find(
        (p) => p.id === selectedSttProvider.provider
      );
      if (!providerConfig && !usePluelyAPI) return;

      const text = await fetchSTT({
        provider: providerConfig,
        selectedProvider: selectedSttProvider,
        audio: base64ToWavBlob(base64Audio),
        contextHint: contextText,
      });

      if (
        generation === partialGenRef.current &&
        isMeaningfulTranscription(text)
      ) {
        setPartialTranscript(text);
      }
    } catch (err) {
      // Preview is best-effort; the final segment will still be transcribed
      console.warn("Partial transcription failed:", err);
    } finally {
      partialBusyRef.current = false;
    }
  };

  const handleSpeechSegment = async (base64Audio: string) => {
    // A final segment supersedes any preview of it
    partialGenRef.current += 1;
    setPartialTranscript("");

    try {
      const audioBlob = base64ToWavBlob(base64Audio);

      const usePluelyAPI = await shouldUsePluelyAPI();
      if (!selectedSttProvider.provider && !usePluelyAPI) {
        setError("No speech provider selected.");
        return;
      }

      const providerConfig = allSttProviders.find(
        (p) => p.id === selectedSttProvider.provider
      );

      if (!providerConfig && !usePluelyAPI) {
        setError("Speech provider config not found.");
        return;
      }

      setIsProcessing(true);

      // Add timeout wrapper for STT request (30 seconds)
      const sttPromise = fetchSTT({
        provider: providerConfig,
        selectedProvider: selectedSttProvider,
        audio: audioBlob,
        contextHint: contextText,
      });

      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(
          () => reject(new Error("Speech transcription timed out (30s)")),
          30000
        );
      });

      try {
        const transcription = await Promise.race([sttPromise, timeoutPromise]);

        if (isMeaningfulTranscription(transcription)) {
          setError("");

          const effectiveSystemPrompt = useSystemPrompt
            ? systemPrompt || DEFAULT_SYSTEM_PROMPT
            : contextContent || DEFAULT_SYSTEM_PROMPT;

          // Merge-on-continuation: if this segment landed right after the
          // previous answer, the VAD most likely split one question at a
          // pause. Drop the half-question's turn, combine the transcripts,
          // and ask once - instead of answering two fragments separately.
          const lastTurn = lastTurnRef.current;
          const shouldMerge =
            behaviorRef.current.mergeContinuation &&
            !!lastTurn &&
            Date.now() - lastTurn.completedAt < MERGE_WINDOW_MS;

          let question = transcription;
          let sourceMessages = conversationRef.current.messages;

          if (shouldMerge && lastTurn) {
            question = `${lastTurn.question} ${transcription}`;
            sourceMessages = sourceMessages.filter(
              (m) =>
                m.id !== lastTurn.userMsgId && m.id !== lastTurn.assistantMsgId
            );
            setConversation((prev) => ({
              ...prev,
              messages: prev.messages.filter(
                (m) =>
                  m.id !== lastTurn.userMsgId &&
                  m.id !== lastTurn.assistantMsgId
              ),
            }));
            lastTurnRef.current = null;
          }

          setLastTranscription(question);

          // Messages are stored newest-first; the AI expects chronological
          // history, so reverse before sending.
          const previousMessages = sourceMessages
            .slice()
            .reverse()
            .map((msg) => ({ role: msg.role, content: msg.content }));

          await processWithAI(question, effectiveSystemPrompt, previousMessages);
        } else {
          setError("Received empty transcription");
        }
      } catch (sttError: any) {
        console.error("STT Error:", sttError);
        setError(sttError.message || "Failed to transcribe audio");
        setIsPopoverOpen(true);
      }
    } catch (err) {
      setError("Failed to process speech");
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle single speech detection event (both VAD and continuous modes).
  // Registered ONCE for the hook's lifetime; segments are chained through a
  // queue so a follow-up question waits for the previous one to finish
  // instead of racing it (which interleaved answers and lost context).
  useEffect(() => {
    let speechUnlisten: (() => void) | undefined;
    let partialUnlisten: (() => void) | undefined;
    let cancelled = false;

    const setupEventListener = async () => {
      try {
        const unlisten = await listen("speech-detected", (event) => {
          if (!capturingRef.current) return;
          const base64Audio = event.payload as string;
          speechQueueRef.current = speechQueueRef.current
            .then(() => handleSpeechSegmentRef.current(base64Audio))
            .catch(() => {});
        });

        // Partial buffers bypass the queue - they're transient previews, not
        // turns, and must never delay or reorder real segments.
        const unlistenPartial = await listen("speech-partial", (event) => {
          if (!capturingRef.current) return;
          if (!vadConfigRef.current.partial_transcripts) return;
          void handlePartialSegmentRef.current(event.payload as string);
        });

        if (cancelled) {
          unlisten();
          unlistenPartial();
        } else {
          speechUnlisten = unlisten;
          partialUnlisten = unlistenPartial;
        }
      } catch (err) {
        setError("Failed to setup speech listener");
      }
    };

    setupEventListener();

    return () => {
      cancelled = true;
      if (speechUnlisten) speechUnlisten();
      if (partialUnlisten) partialUnlisten();
    };
  }, []);

  // Mic context channel: transcribe the user's own voice (opt-in) and add it
  // as context messages. Never triggers an AI answer by itself, but gives the
  // model both sides of the conversation for follow-up questions.
  useMicContext({
    active: capturing && behavior.micContext,
    onTranscript: useCallback((text: string) => {
      const timestamp = Date.now();
      setConversation((prev) => ({
        ...prev,
        messages: [
          {
            id: generateMessageId("user", timestamp),
            role: "user" as const,
            content: `[You]: ${text}`,
            timestamp,
          },
          ...prev.messages,
        ],
        updatedAt: prev.updatedAt || timestamp,
      }));
    }, []),
  });

  // Context management functions
  const saveContextSettings = useCallback(
    (usePrompt: boolean, content: string) => {
      try {
        const contextSettings = {
          useSystemPrompt: usePrompt,
          contextContent: content,
        };
        safeLocalStorage.setItem(
          STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT,
          JSON.stringify(contextSettings)
        );
      } catch (error) {
        console.error("Failed to save context settings:", error);
      }
    },
    []
  );

  const updateUseSystemPrompt = useCallback(
    (value: boolean) => {
      setUseSystemPrompt(value);
      saveContextSettings(value, contextContent);
    },
    [contextContent, saveContextSettings]
  );

  const updateContextContent = useCallback(
    (content: string) => {
      setContextContent(content);
      saveContextSettings(useSystemPrompt, content);
    },
    [useSystemPrompt, saveContextSettings]
  );

  // Quick actions management
  const saveQuickActions = useCallback((actions: string[]) => {
    try {
      safeLocalStorage.setItem(
        STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS,
        JSON.stringify(actions)
      );
    } catch (error) {
      console.error("Failed to save quick actions:", error);
    }
  }, []);

  const addQuickAction = useCallback(
    (action: string) => {
      if (action && !quickActions.includes(action)) {
        const newActions = [...quickActions, action];
        setQuickActions(newActions);
        saveQuickActions(newActions);
      }
    },
    [quickActions, saveQuickActions]
  );

  const removeQuickAction = useCallback(
    (action: string) => {
      const newActions = quickActions.filter((a) => a !== action);
      setQuickActions(newActions);
      saveQuickActions(newActions);
    },
    [quickActions, saveQuickActions]
  );

  const handleQuickActionClick = async (action: string) => {
    setError("");

    const effectiveSystemPrompt = useSystemPrompt
      ? systemPrompt || DEFAULT_SYSTEM_PROMPT
      : contextContent || DEFAULT_SYSTEM_PROMPT;

    // Include the most recent transcription in conversation history if it
    // exists. Messages are stored newest-first; the AI expects chronological
    // order, so reverse before appending the latest transcription.
    let updatedMessages = [...conversation.messages].reverse();

    if (lastTranscription && lastTranscription.trim()) {
      const lastMessage = updatedMessages[updatedMessages.length - 1];
      // Only add if it's not already the last message
      if (!lastMessage || lastMessage.content !== lastTranscription) {
        const timestamp = Date.now();
        const userMessage = {
          id: generateMessageId("user", timestamp),
          role: "user" as const,
          content: lastTranscription,
          timestamp,
        };
        updatedMessages.push(userMessage);

        // Update conversation state with the latest transcription
        setConversation((prev) => ({
          ...prev,
          messages: [userMessage, ...prev.messages],
          updatedAt: timestamp,
          title: prev.title || generateConversationTitle(lastTranscription),
        }));
      }
    }

    const previousMessages = updatedMessages.map((msg) => {
      return { role: msg.role, content: msg.content };
    });

    await processWithAI(action, effectiveSystemPrompt, previousMessages);
  };

  // Start continuous recording manually
  const startContinuousRecording = useCallback(async () => {
    try {
      setRecordingProgress(0);
      setError("");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      // Start a new continuous recording session
      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
      });
    } catch (err) {
      console.error("Failed to start continuous recording:", err);
      setError(`Failed to start recording: ${err}`);
    }
  }, [vadConfig, selectedAudioDevices.output.id]);

  // Ignore current recording (stop without transcription)
  const ignoreContinuousRecording = useCallback(async () => {
    try {
      if (!isContinuousMode || !isRecordingInContinuousMode) return;

      // Stop the capture without processing
      await invoke<string>("stop_system_audio_capture");

      // Reset states
      setRecordingProgress(0);
      setIsProcessing(false);
      setIsRecordingInContinuousMode(false);
    } catch (err) {
      console.error("Failed to ignore recording:", err);
      setError(`Failed to ignore recording: ${err}`);
    }
  }, [isContinuousMode, isRecordingInContinuousMode]);

  // AI Processing function
  const processWithAI = useCallback(
    async (
      transcription: string,
      prompt: string,
      previousMessages: Message[]
    ) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      try {
        setIsAIProcessing(true);
        setLastAIResponse("");
        setError("");

        let fullResponse = "";

        const usePluelyAPI = await shouldUsePluelyAPI();
        if (!selectedAIProvider.provider && !usePluelyAPI) {
          setError("No AI provider selected.");
          return;
        }

        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider
        );
        if (!provider && !usePluelyAPI) {
          setError("AI provider config not found.");
          return;
        }

        try {
          for await (const chunk of fetchAIResponse({
            provider: usePluelyAPI ? undefined : provider,
            selectedProvider: selectedAIProvider,
            systemPrompt: prompt,
            history: previousMessages,
            userMessage: transcription,
            imagesBase64: [],
          })) {
            fullResponse += chunk;
            setLastAIResponse((prev) => prev + chunk);
          }
        } catch (aiError: any) {
          setError(aiError.message || "Failed to get AI response");
          // Don't persist a turn that errored - otherwise a partial stream or
          // an error message would be saved as the assistant's answer.
          return;
        }

        if (fullResponse) {
          const timestamp = Date.now();
          const userMsgId = generateMessageId("user", timestamp);
          const assistantMsgId = generateMessageId("assistant", timestamp + 1);

          setConversation((prev) => ({
            ...prev,
            messages: [
              {
                id: userMsgId,
                role: "user" as const,
                content: transcription,
                timestamp,
              },
              {
                id: assistantMsgId,
                role: "assistant" as const,
                content: fullResponse,
                timestamp: timestamp + 1,
              },
              ...prev.messages,
            ],
            updatedAt: timestamp,
            title: prev.title || generateConversationTitle(transcription),
          }));

          // Remember this turn so an immediate follow-up segment can merge
          // into it (see handleSpeechSegment).
          lastTurnRef.current = {
            question: transcription,
            userMsgId,
            assistantMsgId,
            completedAt: timestamp,
          };
        }
      } catch (err) {
        setError("Failed to get AI response");
      } finally {
        setIsAIProcessing(false);
        // No auto-restart - user manually controls when to start next recording
      }
    },
    [selectedAIProvider, allAiProviders, conversation.messages]
  );

  const startCapture = useCallback(async () => {
    try {
      setError("");

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (!hasAccess) {
        setSetupRequired(true);
        setIsPopoverOpen(true);
        return;
      }

      const isContinuous = !vadConfig.enabled;

      // Set up conversation
      const conversationId = generateConversationId("sysaudio");
      setConversation({
        id: conversationId,
        title: "",
        messages: [],
        createdAt: 0,
        updatedAt: 0,
      });

      setCapturing(true);
      setIsPopoverOpen(true);
      setIsContinuousMode(isContinuous);
      setRecordingProgress(0);
      lastTurnRef.current = null;
      partialGenRef.current += 1;
      setPartialTranscript("");

      // If continuous mode
      if (isContinuous) {
        setIsRecordingInContinuousMode(false);
        return;
      }

      // VAD mode: Start recording immediately
      // Stop any existing capture
      await invoke<string>("stop_system_audio_capture");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      // Start capture with VAD config
      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setIsPopoverOpen(true);
    }
  }, [vadConfig, selectedAudioDevices.output.id]);

  const stopCapture = useCallback(async () => {
    try {
      // Abort any ongoing AI requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      // Stop the audio capture
      await invoke<string>("stop_system_audio_capture");

      // Reset ALL states
      setCapturing(false);
      setIsProcessing(false);
      setIsAIProcessing(false);
      setIsContinuousMode(false);
      setIsRecordingInContinuousMode(false);
      setRecordingProgress(0);
      setLastTranscription("");
      setLastAIResponse("");
      setError("");
      setIsPopoverOpen(false);
      lastTurnRef.current = null;
      partialGenRef.current += 1;
      setPartialTranscript("");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to stop capture: ${errorMessage}`);
      console.error("Stop capture error:", err);
    }
  }, []);

  // Manual stop for continuous recording
  const manualStopAndSend = useCallback(async () => {
    try {
      if (!isContinuousMode) {
        console.warn("Not in continuous mode");
        return;
      }

      // Show processing state immediately
      setIsProcessing(true);

      // Trigger manual stop event
      await invoke("manual_stop_continuous");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to manually stop: ${errorMessage}`);
      setIsProcessing(false); // Clear processing state on error
      console.error("Manual stop error:", err);
    }
  }, [isContinuousMode]);

  const handleSetup = useCallback(async () => {
    try {
      const platform = navigator.platform.toLowerCase();

      if (platform.includes("mac") || platform.includes("win")) {
        await invoke("request_system_audio_access");
      }

      // Delay to give the user time to grant permissions in the system dialog.
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (hasAccess) {
        setSetupRequired(false);
        await startCapture();
      } else {
        setSetupRequired(true);
        setError("Permission not granted. Please try the manual steps.");
      }
    } catch (err) {
      setError("Failed to request access. Please try the manual steps below.");
      setSetupRequired(true);
    }
  }, [startCapture]);

  useEffect(() => {
    const shouldOpenPopover =
      capturing ||
      setupRequired ||
      isAIProcessing ||
      !!lastAIResponse ||
      !!error;
    setIsPopoverOpen(shouldOpenPopover);
    resizeWindow(shouldOpenPopover);
  }, [
    capturing,
    setupRequired,
    isAIProcessing,
    lastAIResponse,
    error,
    resizeWindow,
  ]);

  useEffect(() => {
    globalShortcuts.registerSystemAudioCallback(async () => {
      if (capturing) {
        await stopCapture();
      } else {
        await startCapture();
      }
    });
  }, [startCapture, stopCapture]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      invoke("stop_system_audio_capture").catch(() => {});
    };
  }, []);

  // Debounced save to prevent race conditions and improve performance
  useEffect(() => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Only debounce if there are messages to save
    if (
      !conversation.id ||
      conversation.updatedAt === 0 ||
      conversation.messages.length === 0
    ) {
      return;
    }

    // Debounce saves (only save 500ms after last change)
    saveTimeoutRef.current = setTimeout(async () => {
      // Don't save if already saving (prevent concurrent saves)
      if (isSavingRef.current) {
        return;
      }

      try {
        isSavingRef.current = true;
        await saveConversation(conversation);
      } catch (error) {
        console.error("Failed to save system audio conversation:", error);
      } finally {
        isSavingRef.current = false;
      }
    }, CONVERSATION_SAVE_DEBOUNCE_MS);

    // Cleanup on unmount or dependency change
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    conversation.messages.length,
    conversation.title,
    conversation.id,
    conversation.updatedAt,
  ]);

  const startNewConversation = useCallback(() => {
    setConversation({
      id: generateConversationId("sysaudio"),
      title: "",
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    });
    setLastTranscription("");
    setLastAIResponse("");
    setError("");
    setSetupRequired(false);
    setIsProcessing(false);
    setIsAIProcessing(false);
    setIsPopoverOpen(false);
    setUseSystemPrompt(true);
    lastTurnRef.current = null;
    partialGenRef.current += 1;
    setPartialTranscript("");
  }, []);

  // Update VAD configuration
  const updateVadConfiguration = useCallback(async (config: VadConfig) => {
    try {
      setVadConfig(config);
      safeLocalStorage.setItem("vad_config_v2", JSON.stringify(config));
      await invoke("update_vad_config", { config });
    } catch (error) {
      console.error("Failed to update VAD config:", error);
    }
  }, []);

  useEffect(() => {
    if (capturing) {
      setIsContinuousMode(!vadConfig.enabled);

      if (!vadConfig.enabled) {
        setIsRecordingInContinuousMode(false);
      }
    }
  }, [vadConfig.enabled, capturing]);

  // Keyboard arrow key support for scrolling (local shortcut)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;
      // Alt/Cmd/Ctrl + arrows are reserved for question navigation
      if (e.altKey || e.metaKey || e.ctrlKey) return;

      const scrollElement = scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]"
      ) as HTMLElement;

      if (!scrollElement) return;

      const scrollAmount = 100; // pixels to scroll

      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollElement.scrollBy({ top: scrollAmount, behavior: "smooth" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollElement.scrollBy({ top: -scrollAmount, behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopoverOpen]);

  // Keyboard shortcuts for continuous mode recording (local shortcuts)
  useEffect(() => {
    const handleRecordingShortcuts = (e: KeyboardEvent) => {
      if (!isPopoverOpen || !isContinuousMode) return;
      if (isProcessing || isAIProcessing) return;

      // Enter: Start recording (when not recording) or Stop & Send (when recording)
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (!isRecordingInContinuousMode) {
          startContinuousRecording();
        } else {
          manualStopAndSend();
        }
      }

      // Escape: Ignore recording (when recording)
      if (e.key === "Escape" && isRecordingInContinuousMode) {
        e.preventDefault();
        ignoreContinuousRecording();
      }

      // Space: Start recording (when not recording) - only if not typing in input
      if (
        e.key === " " &&
        !isRecordingInContinuousMode &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        startContinuousRecording();
      }
    };

    window.addEventListener("keydown", handleRecordingShortcuts);
    return () =>
      window.removeEventListener("keydown", handleRecordingShortcuts);
  }, [
    isPopoverOpen,
    isContinuousMode,
    isRecordingInContinuousMode,
    isProcessing,
    isAIProcessing,
    startContinuousRecording,
    manualStopAndSend,
    ignoreContinuousRecording,
  ]);

  return {
    capturing,
    isProcessing,
    isAIProcessing,
    lastTranscription,
    lastAIResponse,
    error,
    setupRequired,
    startCapture,
    stopCapture,
    handleSetup,
    isPopoverOpen,
    setIsPopoverOpen,
    // Conversation management
    conversation,
    setConversation,
    // AI processing
    processWithAI,
    // Context management
    useSystemPrompt,
    setUseSystemPrompt: updateUseSystemPrompt,
    contextContent,
    setContextContent: updateContextContent,
    startNewConversation,
    // Window resize
    resizeWindow,
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    handleQuickActionClick,
    // VAD configuration
    vadConfig,
    updateVadConfiguration,
    // Live transcript preview
    partialTranscript,
    // Behavior settings (merge-on-continuation, mic context)
    behavior,
    updateBehavior,
    // Continuous recording
    isContinuousMode,
    isRecordingInContinuousMode,
    recordingProgress,
    manualStopAndSend,
    startContinuousRecording,
    ignoreContinuousRecording,
    // Scroll area ref for keyboard navigation
    scrollAreaRef,
  };
}
