import {
  buildDynamicMessages,
  deepVariableReplacer,
  extractVariables,
  getByPath,
  getStreamingContent,
} from "./common.function";
import { Message, TYPE_PROVIDER } from "@/types";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import curl2Json from "@bany/curl-to-json";
import { shouldUsePluelyAPI } from "./pluely.api";
import {
  debugLog,
  isDebugEnabled,
  redactHeaders,
  redactUrl,
  truncateForLog,
} from "./debug.function";
import { getResponseSettings, RESPONSE_LENGTHS, LANGUAGES } from "@/lib";
import { MARKDOWN_FORMATTING_INSTRUCTIONS } from "@/config/constants";

function buildEnhancedSystemPrompt(baseSystemPrompt?: string): string {
  const responseSettings = getResponseSettings();
  const prompts: string[] = [];

  if (baseSystemPrompt) {
    prompts.push(baseSystemPrompt);
  }

  const lengthOption = RESPONSE_LENGTHS.find(
    (l) => l.id === responseSettings.responseLength
  );
  if (lengthOption?.prompt?.trim()) {
    prompts.push(lengthOption.prompt);
  }

  const languageOption = LANGUAGES.find(
    (l) => l.id === responseSettings.language
  );
  if (languageOption?.prompt?.trim()) {
    prompts.push(languageOption.prompt);
  }

  // Add markdown formatting instructions
  prompts.push(MARKDOWN_FORMATTING_INSTRUCTIONS);

  return prompts.join(" ");
}

// Pluely AI streaming function
async function* fetchPluelyAIResponse(params: {
  systemPrompt?: string;
  userMessage: string;
  imagesBase64?: string[];
  history?: Message[];
  signal?: AbortSignal;
}): AsyncIterable<string> {
  try {
    const {
      systemPrompt,
      userMessage,
      imagesBase64 = [],
      history = [],
      signal,
    } = params;

    // Check if already aborted before starting
    if (signal?.aborted) {
      return;
    }

    // Convert history to the expected format
    let historyString: string | undefined;
    if (history.length > 0) {
      // Create a copy before reversing to avoid mutating the original array
      const formattedHistory = [...history].reverse().map((msg) => ({
        role: msg.role,
        content: [{ type: "text", text: msg.content }],
      }));
      historyString = JSON.stringify(formattedHistory);
    }

    // Handle images - can be string or array
    let imageBase64: any = undefined;
    if (imagesBase64.length > 0) {
      imageBase64 = imagesBase64.length === 1 ? imagesBase64[0] : imagesBase64;
    }

    // Set up streaming via an async queue so chunks yield the instant they
    // arrive, instead of polling on a timer. A parked promise is resolved by
    // the listen callbacks the moment a chunk lands or the stream completes.
    const queue: string[] = [];
    let streamComplete = false;
    let notify: (() => void) | null = null;

    // Wake the generator if it's currently parked waiting for the next event.
    const wake = () => {
      if (notify) {
        const resolve = notify;
        notify = null;
        resolve();
      }
    };

    const unlisten = await listen("chat_stream_chunk", (event) => {
      queue.push(event.payload as string);
      wake();
    });

    const unlistenComplete = await listen("chat_stream_complete", () => {
      streamComplete = true;
      wake();
    });

    const onAbort = () => wake();
    signal?.addEventListener("abort", onAbort);

    try {
      // Check if aborted before starting invoke
      if (signal?.aborted) {
        return;
      }

      debugLog("[Pluely ▶ request] chat_stream_response", {
        userMessage,
        systemPrompt,
        hasImage: imageBase64 !== undefined,
        historyMessages: history.length,
      });

      // Start the streaming request using the new API response endpoint
      await invoke("chat_stream_response", {
        userMessage,
        systemPrompt,
        imageBase64,
        history: historyString,
      });

      // Yield chunks as they arrive. Completion only breaks the loop once the
      // queue has been fully drained, so trailing chunks are never dropped.
      const debugChunks: string[] = [];
      while (true) {
        if (signal?.aborted) {
          return;
        }

        if (queue.length > 0) {
          const chunk = queue.shift() as string;
          if (isDebugEnabled()) debugChunks.push(chunk);
          yield chunk;
          continue;
        }

        if (streamComplete) {
          break;
        }

        // Park until a chunk lands, the stream completes, or we abort.
        await new Promise<void>((resolve) => {
          notify = resolve;
          // Guard against a state change between the checks above and parking.
          if (queue.length > 0 || streamComplete || signal?.aborted) {
            wake();
          }
        });
      }

      debugLog("[Pluely ◀ done] full response:", debugChunks.join(""));
    } finally {
      signal?.removeEventListener("abort", onAbort);
      unlisten();
      unlistenComplete();
    }
  } catch (error) {
    // A cancelled request is not an error - stay silent so it isn't surfaced.
    if (params.signal?.aborted) return;
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Throw instead of yielding: a yielded string becomes response content and
    // gets saved as an assistant message, polluting the conversation history.
    throw new Error(`Pluely API Error: ${errorMessage}`);
  }
}

export async function* fetchAIResponse(params: {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  systemPrompt?: string;
  history?: Message[];
  userMessage: string;
  imagesBase64?: string[];
  signal?: AbortSignal;
}): AsyncIterable<string> {
  try {
    const {
      provider,
      selectedProvider,
      systemPrompt,
      history = [],
      userMessage,
      imagesBase64 = [],
      signal,
    } = params;

    // Check if already aborted
    if (signal?.aborted) {
      return;
    }

    const enhancedSystemPrompt = buildEnhancedSystemPrompt(systemPrompt);

    // Check if we should use Pluely API instead
    const usePluelyAPI = await shouldUsePluelyAPI();
    if (usePluelyAPI) {
      yield* fetchPluelyAIResponse({
        systemPrompt: enhancedSystemPrompt,
        userMessage,
        imagesBase64,
        history,
        signal,
      });
      return;
    }
    if (!provider) {
      throw new Error(`Provider not provided`);
    }
    if (!selectedProvider) {
      throw new Error(`Selected provider not provided`);
    }

    let curlJson;
    try {
      curlJson = curl2Json(provider.curl);
    } catch (error) {
      throw new Error(
        `Failed to parse curl: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    const extractedVariables = extractVariables(provider.curl);
    const requiredVars = extractedVariables.filter(
      ({ key }) => key !== "SYSTEM_PROMPT" && key !== "TEXT" && key !== "IMAGE"
    );
    for (const { key } of requiredVars) {
      if (
        !selectedProvider.variables?.[key] ||
        selectedProvider.variables[key].trim() === ""
      ) {
        throw new Error(
          `Missing required variable: ${key}. Please configure it in settings.`
        );
      }
    }

    if (!userMessage) {
      throw new Error("User message is required");
    }
    if (imagesBase64.length > 0 && !provider.curl.includes("{{IMAGE}}")) {
      throw new Error(
        `Provider ${provider?.id ?? "unknown"} does not support image input`
      );
    }

    let bodyObj: any = curlJson.data
      ? JSON.parse(JSON.stringify(curlJson.data))
      : {};
    const messagesKey = Object.keys(bodyObj).find((key) =>
      ["messages", "contents", "conversation", "history"].includes(key)
    );

    if (messagesKey && Array.isArray(bodyObj[messagesKey])) {
      const finalMessages = buildDynamicMessages(
        bodyObj[messagesKey],
        history,
        userMessage,
        imagesBase64
      );
      bodyObj[messagesKey] = finalMessages;
    }

    const allVariables = {
      ...Object.fromEntries(
        Object.entries(selectedProvider.variables).map(([key, value]) => [
          key.toUpperCase(),
          value,
        ])
      ),
      SYSTEM_PROMPT: enhancedSystemPrompt || "",
    };

    bodyObj = deepVariableReplacer(bodyObj, allVariables);
    let url = deepVariableReplacer(curlJson.url || "", allVariables);

    const headers = deepVariableReplacer(curlJson.header || {}, allVariables);
    headers["Content-Type"] = "application/json";

    if (provider?.streaming) {
      if (typeof bodyObj === "object" && bodyObj !== null) {
        const streamKey = Object.keys(bodyObj).find(
          (k) => k.toLowerCase() === "stream"
        );
        if (streamKey) {
          bodyObj[streamKey] = true;
        } else {
          bodyObj.stream = true;
        }
      }
    }

    const fetchFunction = url?.includes("http") ? fetch : tauriFetch;

    debugLog(
      `[AI ▶ request] ${provider?.id ?? "custom"} ${
        curlJson.method || "POST"
      } ${redactUrl(url)}`,
      {
        headers: redactHeaders(headers),
        body: truncateForLog(bodyObj),
      }
    );

    let response;
    try {
      response = await fetchFunction(url, {
        method: curlJson.method || "POST",
        headers,
        body: curlJson.method === "GET" ? undefined : JSON.stringify(bodyObj),
        signal,
      });
    } catch (fetchError) {
      // Check if aborted
      if (
        signal?.aborted ||
        (fetchError instanceof Error && fetchError.name === "AbortError")
      ) {
        return; // Silently return on abort
      }
      throw new Error(
        `Network error during API request: ${
          fetchError instanceof Error ? fetchError.message : "Unknown error"
        }`
      );
    }

    debugLog(
      `[AI ◀ status] ${response.status} ${response.statusText} ok=${response.ok}`
    );

    if (!response.ok) {
      let errorText = "";
      try {
        errorText = await response.text();
      } catch {}
      debugLog("[AI ◀ error body]", errorText);
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}${
          errorText ? ` - ${errorText}` : ""
        }`
      );
    }

    if (!provider?.streaming) {
      let json;
      try {
        json = await response.json();
      } catch (parseError) {
        throw new Error(
          `Failed to parse non-streaming response: ${
            parseError instanceof Error ? parseError.message : "Unknown error"
          }`
        );
      }
      debugLog("[AI ◀ response (non-stream)]", truncateForLog(json));
      const content =
        getByPath(json, provider?.responseContentPath || "") || "";
      debugLog("[AI ◀ extracted content]", content);
      yield content;
      return;
    }

    if (!response.body) {
      throw new Error("Streaming not supported or response body missing");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let debugFull = "";

    while (true) {
      // Check if aborted
      if (signal?.aborted) {
        reader.cancel();
        return;
      }

      let readResult;
      try {
        readResult = await reader.read();
      } catch (readError) {
        // Check if aborted
        if (
          signal?.aborted ||
          (readError instanceof Error && readError.name === "AbortError")
        ) {
          return; // Silently return on abort
        }
        throw new Error(
          `Error reading stream: ${
            readError instanceof Error ? readError.message : "Unknown error"
          }`
        );
      }
      const { done, value } = readResult;
      if (done) {
        debugLog("[AI ◀ done] full response:", debugFull);
        break;
      }

      // Check if aborted before processing
      if (signal?.aborted) {
        reader.cancel();
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const trimmed = line.substring(5).trim();
          if (!trimmed || trimmed === "[DONE]") continue;
          try {
            const parsed = JSON.parse(trimmed);
            const delta = getStreamingContent(
              parsed,
              provider?.responseContentPath || ""
            );
            if (delta) {
              if (isDebugEnabled()) debugFull += delta;
              yield delta;
            }
          } catch (e) {
            // Ignore parsing errors for partial JSON chunks
          }
        }
      }
    }
  } catch (error) {
    // Preserve the original error (and its message) rather than re-wrapping, so
    // callers can show the real cause (e.g. "API request failed: 400 ...").
    throw error instanceof Error
      ? error
      : new Error(`Error in fetchAIResponse: ${String(error)}`);
  }
}
