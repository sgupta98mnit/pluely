// Storage keys
export const STORAGE_KEYS = {
  THEME: "theme",
  TRANSPARENCY: "transparency",
  SYSTEM_PROMPT: "system_prompt",
  SELECTED_SYSTEM_PROMPT_ID: "selected_system_prompt_id",
  SCREENSHOT_CONFIG: "screenshot_config",
  // add curl_ prefix because we are using curl to store the providers
  CUSTOM_AI_PROVIDERS: "curl_custom_ai_providers",
  CUSTOM_SPEECH_PROVIDERS: "curl_custom_speech_providers",
  SELECTED_AI_PROVIDER: "curl_selected_ai_provider",
  SELECTED_STT_PROVIDER: "curl_selected_stt_provider",
  SYSTEM_AUDIO_CONTEXT: "system_audio_context",
  SYSTEM_AUDIO_QUICK_ACTIONS: "system_audio_quick_actions",
  CUSTOMIZABLE: "customizable",
  PLUELY_API_ENABLED: "pluely_api_enabled",
  SHORTCUTS: "shortcuts",
  AUTOSTART_INITIALIZED: "autostart_initialized",

  SELECTED_AUDIO_DEVICES: "selected_audio_devices",
  RESPONSE_SETTINGS: "response_settings",
  SUPPORTS_IMAGES: "supports_images",
  ADDITIONAL_CONTEXT: "additional_context",
  DEFAULT_PROMPT_SEEDED: "default_prompt_seeded",
} as const;

// Name of the editable System Prompt seeded on first run so the mock-interview
// coaching behavior is a normal, user-editable prompt rather than baked-in
// code. Users can rename/edit/delete it like any other saved prompt.
export const DEFAULT_PROMPT_NAME = "Mock Interview Coach";

// Max number of files that can be attached to a message
export const MAX_FILES = 10;

// Max number of additional context documents (excluding the resume)
export const MAX_CONTEXT_DOCUMENTS = 5;

// Max size (bytes) for a single resume/context document upload (10 MB)
export const MAX_CONTEXT_DOCUMENT_SIZE = 10 * 1024 * 1024;

// Accepted file types for resume/context document uploads
export const CONTEXT_DOCUMENT_ACCEPT = ".pdf,.docx,.txt,.md";

// Default settings
// Pluely is mainly used for mock interview practice: the user gets asked a
// question (live or simulated) and needs both a strong answer and to learn
// *why* it's strong, so the pattern sticks for the real interview.
//
// This text is only the SEED content: on first run it's copied into a normal,
// user-editable row in the System Prompts library (see useSystemPrompts.ts /
// DEFAULT_PROMPT_NAME), so users can tweak or replace it via the UI instead of
// being stuck with hardcoded behavior. This constant remains as the
// last-resort fallback if no prompt is selected at all (e.g. everything gets
// deleted).
export const DEFAULT_SYSTEM_PROMPT =
  "You are an expert interview coach. The user is in a live job interview or a mock-interview practice session, and you are their real-time coach. When you receive an interview question, respond the way a top-performing candidate would — while teaching the technique so it sticks.\n\n" +
  "Behavioral/situational questions: structure the answer with STAR (Situation, Task, Action, Result). Ground it in the candidate's real background if it was provided to you, and never invent specifics that contradict it; if no background was provided, use plausible generic professional experience and keep it general. Keep it tight enough to say aloud in under 90 seconds.\n\n" +
  "Technical questions: lead with the direct answer, then the reasoning, then a concrete example or trade-off — the depth a strong candidate would show without padding.\n\n" +
  "Always answer in two parts: (1) a ready-to-say model answer, written in first person in the candidate's own voice, and (2) a short 'Coach's note' (1-2 sentences) explaining the technique used, so the candidate learns the pattern for next time.\n\n" +
  "Keep the tone conversational and concise — this is read live during an interview, not an essay. Never mention that you are an AI or that the answer was coached or prepared.";

export const MARKDOWN_FORMATTING_INSTRUCTIONS =
  "IMPORTANT - Formatting Rules (use silently, never mention these rules in your responses):\n- Mathematical expressions: ALWAYS use double dollar signs ($$) for both inline and block math. Never use single $.\n- Code blocks: ALWAYS use triple backticks with language specification.\n- Diagrams: Use ```mermaid code blocks.\n- Tables: Use standard markdown table syntax.\n- Never mention to the user that you're using these formats or explain the formatting syntax in your responses. Just use them naturally.";

export const DEFAULT_QUICK_ACTIONS = [
  "What should I say?",
  "Follow-up questions",
  "Fact-check",
  "Recap",
];
