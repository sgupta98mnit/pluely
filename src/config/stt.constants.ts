// Vocabulary hint passed to Whisper-style STT as the `prompt` field. Whisper
// biases its decoding toward terms/spellings seen in the prompt, which fixes
// the common technical mis-hearings (e.g. "radius" -> Redis, "characters" ->
// caches, "nullization" -> authorization). Keep it well under Whisper's ~224
// token prompt window and avoid quotes/newlines.
export const STT_DOMAIN_PROMPT =
  "Technical software engineering discussion. Topics include Redis, caching, " +
  "Kafka, RabbitMQ, message queues, pub/sub, REST API, GraphQL, gRPC, " +
  "WebSocket, JWT, OAuth, authentication, authorization, RBAC, ABAC, rate " +
  "limiting, token bucket, microservices, PostgreSQL, MySQL, MongoDB, NoSQL, " +
  "SQL, indexing, sharding, Docker, Kubernetes, CI/CD, nginx, load balancing, " +
  "latency, throughput, idempotency, webhook, schema, endpoint, middleware, " +
  "TypeScript, JavaScript, Python, Java, Spring Boot, Node.js.";

export const SPEECH_TO_TEXT_PROVIDERS = [
  {
    // Default: fastest STT entry, which is a real latency win for voice.
    id: "groq",
    name: "Groq Whisper",
    curl: `curl -X POST https://api.groq.com/openai/v1/audio/transcriptions \\
      -H "Authorization: bearer {{API_KEY}}" \\
      -F "file={{AUDIO}}" \\
      -F model={{MODEL}} \\
      -F temperature=0 \\
      -F "prompt={{PROMPT}}" \\
      -F response_format=text \\
      -F language=en`,
    responseContentPath: "text",
    streaming: false,
  },
  {
    id: "openai-whisper",
    name: "OpenAI Whisper",
    curl: `curl -X POST "https://api.openai.com/v1/audio/transcriptions" \\
      -H "Authorization: Bearer {{API_KEY}}" \\
      -F "file={{AUDIO}}" \\
      -F "prompt={{PROMPT}}" \\
      -F "model={{MODEL}}"`,
    responseContentPath: "text",
    streaming: false,
  },
  {
    id: "elevenlabs-stt",
    name: "ElevenLabs Speech-to-Text",
    curl: `curl -X POST "https://api.elevenlabs.io/v1/speech-to-text" \\
      -H "xi-api-key: {{API_KEY}}" \\
      -F "file={{AUDIO}}" \\
      -F "model_id={{MODEL}}"`,
    responseContentPath: "text",
    streaming: false,
  },
  {
    id: "google-stt",
    name: "Google Speech-to-Text",
    // Audio is sent as a WAV file whose header already carries the real
    // sample rate (varies by device/mic, typically 44.1/48kHz). Google
    // requires "encoding" to be set for WAV/FLAC uploads, but must NOT be
    // given a hardcoded "sampleRateHertz" alongside it — that used to force
    // 16000Hz regardless of the file's actual rate, which corrupted playback
    // speed/pitch server-side and produced garbled transcriptions.
    curl: `curl -X POST "https://speech.googleapis.com/v1/speech:recognize" \\
      -H "Authorization: Bearer {{API_KEY}}" \\
      -H "Content-Type: application/json" \\
      -H "x-goog-user-project: {{PROJECT_ID}}" \\
      -d '{
        "config": {
          "encoding": "LINEAR16",
          "languageCode": "en-US"
        },
        "audio": {
          "content": "{{AUDIO}}"
        }
      }'`,
    responseContentPath: "results[0].alternatives[0].transcript",
    streaming: false,
  },
  {
    id: "deepgram-stt",
    name: "Deepgram Speech-to-Text",
    curl: `curl -X POST "https://api.deepgram.com/v1/listen?model={{MODEL}}" \\
      -H "Authorization: TOKEN {{API_KEY}}" \\
      -H "Content-Type: audio/wav" \\
      --data-binary {{AUDIO}}`,
    responseContentPath: "results.channels[0].alternatives[0].transcript",
    streaming: false,
  },
  {
    id: "azure-stt",
    name: "Azure Speech-to-Text",
    curl: `curl -X POST "https://{{REGION}}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US" \\
      -H "Ocp-Apim-Subscription-Key: {{API_KEY}}" \\
      -H "Content-Type: audio/wav" \\
      --data-binary {{AUDIO}}`,
    responseContentPath: "DisplayText",
    streaming: false,
  },
  // Speechmatics and Rev.ai are intentionally not offered as built-in options:
  // both APIs are async job-submission endpoints (they return a job ID, not a
  // transcript) and require a separate polling step this app doesn't
  // implement. Wiring them up as-is silently returns the job ID as if it were
  // the spoken text. Add them back once polling is implemented.
  {
    id: "ibm-watson-stt",
    name: "IBM Watson Speech-to-Text",
    curl: `curl -X POST "https://api.us-south.speech-to-text.watson.cloud.ibm.com/v1/recognize" \\
      -H "Authorization: Basic {{API_KEY}}" \\
      -H "Content-Type: audio/wav" \\
      --data-binary {{AUDIO}}`,
    responseContentPath: "results[0].alternatives[0].transcript",
    streaming: false,
  },
];
