// Encodes an audio Blob to base64 off the main thread so the UI doesn't block
// while encoding the whole clip (used by the JSON STT providers and the Pluely
// STT path). Receives a Blob, posts back `{ base64 }` or `{ error }`.
//
// Typed against the DOM lib (the project's tsconfig has no "webworker" lib):
// `self` is cast to `Worker`, whose `postMessage` accepts a single argument.
const ctx = self as unknown as Worker;

ctx.addEventListener("message", async (event: MessageEvent<Blob>) => {
  try {
    const buffer = await event.data.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Build the binary string in chunks to stay within argument-count limits.
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }

    ctx.postMessage({ base64: btoa(binary) });
  } catch (error) {
    ctx.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export {};
