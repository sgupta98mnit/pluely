export const AI_PROVIDERS = [
  {
    id: "openai",
    curl: `curl https://api.openai.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
  }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
    models: [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "o3",
      "o4-mini",
    ],
  },
  {
    id: "claude",
    curl: `curl https://api.anthropic.com/v1/messages \\
  -H "x-api-key: {{API_KEY}}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "anthropic-dangerous-direct-browser-access: true" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "{{MODEL}}",
    "system": "{{SYSTEM_PROMPT}}",
    "messages": [{"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "{{IMAGE}}"}}]}],
    "max_tokens": 1024
  }'`,
    responseContentPath: "content[0].text",
    streaming: true,
    models: [
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-5",
      "claude-opus-4-5",
      "claude-opus-4-1",
    ],
  },
  {
    id: "grok",
    curl: `curl https://api.x.ai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
  }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
    models: ["grok-4", "grok-3", "grok-3-mini", "grok-2-vision-1212"],
  },
  {
    id: "gemini",
    curl: `curl "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
  }'}`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
  },
  {
    id: "mistral",
    curl: `curl https://api.mistral.ai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": "data:image/png;base64,{{IMAGE}}"}]}]
  }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
    models: [
      "mistral-large-latest",
      "mistral-small-latest",
      "pixtral-large-latest",
    ],
  },
  {
    id: "cohere",
    curl: `curl -X POST https://api.cohere.ai/v2/chat \\
    -H "Authorization: Bearer {{API_KEY}}" \\
    -H "Content-Type: application/json" \\
    -d '{
      "model": "{{MODEL}}",
      "preamble": "{{SYSTEM_PROMPT}}",
      "messages": [{"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
    }'`,
    responseContentPath: "message.content[0].text",
    streaming: true,
    models: ["command-a-03-2025", "command-r-plus", "command-r"],
  },
  {
    id: "groq",
    curl: `curl https://api.groq.com/openai/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer {{API_KEY}}" \
    -d '{
      "model": "{{MODEL}}",
      "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}],
      "temperature": 1,
      "max_completion_tokens": 8192,
      "top_p": 1,
      "stream": true,
      "reasoning_effort": "medium",
      "stop": null
    }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "gemma2-9b-it",
    ],
  },
  {
    id: "perplexity",
    curl: `curl -X POST https://api.perplexity.ai/chat/completions \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
  }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
    models: ["sonar", "sonar-pro", "sonar-reasoning"],
  },
  {
    id: "openrouter",
    curl: `  curl https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {{API_KEY}}" \
  -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
  }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
  },
  {
    id: "ollama",
    curl: `curl -X POST http://localhost:11434/v1/chat/completions \\
    -H "Authorization: Bearer {{API_KEY}}" \\
    -H "Content-Type: application/json" \\
    -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,{{IMAGE}}"}}]}]
  }'`,
    responseContentPath: "choices[0].message.content",
    streaming: true,
  },
];
