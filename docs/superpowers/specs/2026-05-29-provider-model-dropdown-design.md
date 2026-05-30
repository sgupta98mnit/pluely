# Provider Model Dropdown — Design

**Date:** 2026-05-29
**Status:** Approved

## Problem

In Dev Space → AI Providers, after selecting a provider and entering an API key,
the **model** field is a free-text input ([Providers.tsx](../../../src/pages/dev/components/ai-configs/Providers.tsx)).
Users must look up exact model IDs (e.g. `gpt-4o`, `claude-sonnet-4-5`) on the
internet and type them by hand. We want a searchable dropdown of popular models
per provider so selection is one click, while still allowing any custom model.

## Scope

- Custom-provider (frontend) path only. **No Rust/backend changes.**
- Pluely-API mode is untouched (it already has its own model picker).
- Affects the built-in providers in
  [ai-providers.constants.ts](../../../src/config/ai-providers.constants.ts) and the
  `model` field rendering in
  [Providers.tsx](../../../src/pages/dev/components/ai-configs/Providers.tsx).

## Design

### 1. Data: curated model lists

Add an optional `models?: string[]` to:
- `TYPE_PROVIDER` ([provider.type.ts](../../../src/types/provider.type.ts))
- each built-in entry in `AI_PROVIDERS`

Curated popular models per provider (snapshot; editable any time):

| Provider   | Models (popular) |
|------------|------------------|
| openai     | gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini, o3, o4-mini |
| claude     | claude-opus-4-1, claude-sonnet-4-5, claude-3-7-sonnet-latest, claude-3-5-haiku-latest |
| grok       | grok-4, grok-3, grok-3-mini, grok-2-vision-1212 |
| gemini     | gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash |
| mistral    | mistral-large-latest, mistral-small-latest, pixtral-large-latest |
| cohere     | command-a-03-2025, command-r-plus, command-r |
| groq       | llama-3.3-70b-versatile, llama-3.1-8b-instant, gemma2-9b-it |
| perplexity | sonar, sonar-pro, sonar-reasoning |
| openrouter | (none — free-text) |
| ollama     | (none — free-text) |

Providers with no list (`openrouter`, `ollama`) fall back to the current
free-text input, since their model sets are huge/local and change constantly.

### 2. UI: model combobox

In [Providers.tsx](../../../src/pages/dev/components/ai-configs/Providers.tsx),
special-case the `model` variable (the same way `api_key` is already
special-cased) and render it directly below the API Key section:

- If the selected provider has a non-empty `models` list → render a searchable
  combobox using the existing `Command` / `Popover` components (already used in
  [PluelyApiSetup.tsx](../../../src/pages/dashboard/components/PluelyApiSetup.tsx)).
  - Lists curated models, filterable by typing.
  - Shows a **"Use \"<typed value>\""** custom option so any model not in the
    list still works (the searchable-dropdown-with-custom-fallback behavior).
  - Selecting writes to `selectedAIProvider.variables[model_key]`, exactly like
    the current text input does.
- If the provider has no `models` list → render the existing plain `TextInput`
  (unchanged behavior).

The remaining generic variables loop continues to render any non-`api_key`,
non-`model` variables as today.

### 3. Data flow (unchanged downstream)

The selected model is still stored in `selectedAIProvider.variables` and
substituted into `{{MODEL}}` by
[ai-response.function.ts](../../../src/lib/functions/ai-response.function.ts).
No change to request building, streaming, or storage.

## Trade-offs

- **Static snapshot:** curated lists drift as providers ship new models. Accepted
  because the custom fallback never blocks the user, and updating is a one-line
  edit per provider.
- **No live fetch:** we deliberately do not call each provider's `/models` API
  (extra auth/network/error surface, inconsistent across providers). Chosen for
  simplicity per user request ("select the popular ones").

## Out of scope

- Live model fetching from provider APIs.
- Model lists for custom user-defined providers (they keep free-text).
- Any backend / Pluely-API changes.
