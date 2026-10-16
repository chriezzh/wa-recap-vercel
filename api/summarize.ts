// POST /api/summarize — receives the chat text, calls OpenRouter with the
// server-side key, and streams the summary back as plain text.
//
// Environment variables (set in Vercel → Project → Settings → Environment Variables):
//   OPENROUTER_API_KEY  required  your OpenRouter key
//   OPENROUTER_MODEL    required  model id copied from openrouter.ai/models
//   APP_PASSWORD        optional  if set, visitors must enter it to summarize

const PROMPT = `Rekap chat ini sesingkat mungkin. Kelompokkan per topik:

**[Nama topik]**
- Hasil/keputusan: 1 kalimat
- Belum selesai: 1 kalimat (lewati jika tidak ada)

**Next steps:** daftar langkah konkret dari semua topik.

Maksimal 3 bullet per topik. Tulis hanya versi final, angka/nama/tanggal persis.`;

const MAX_CHAT_CHARS = 180_000;

function json(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;
  if (!apiKey || !model) {
    return json(500, "Server is missing OPENROUTER_API_KEY or OPENROUTER_MODEL. Set them in Vercel and redeploy.");
  }

  const password = process.env.APP_PASSWORD;
  if (password && req.headers.get("x-app-password") !== password) {
    return json(401, "Wrong password.");
  }

  let chat: string;
  try {
    const body = (await req.json()) as { chat?: unknown };
    chat = typeof body.chat === "string" ? body.chat.trim() : "";
  } catch {
    return json(400, "Request body must be JSON with a \"chat\" field.");
  }
  if (!chat) return json(400, "The chat file is empty.");

  let trimmed = false;
  if (chat.length > MAX_CHAT_CHARS) {
    chat = chat.slice(-MAX_CHAT_CHARS);
    trimmed = true;
  }

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "x-title": "WA Chat Recap",
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{ role: "user", content: `${PROMPT}\n\n--- CHAT ---\n${chat}` }],
    }),
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    let detail = `${upstream.status}`;
    try {
      const err = (await upstream.json()) as { error?: { message?: string } };
      if (err.error?.message) detail += ` ${err.error.message}`;
    } catch { /* keep status only */ }
    return json(502, `OpenRouter error: ${detail}`);
  }

  return new Response(sseToText(upstream.body), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-chat-trimmed": trimmed ? "1" : "0",
    },
  });
}

// Turns OpenRouter's server-sent events into a stream of plain summary text.
export function sseToText(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) emit(line, controller);
      },
      flush(controller) {
        if (buffer) emit(buffer, controller);
      },
    })
  );

  function emit(line: string, controller: TransformStreamDefaultController<Uint8Array>): void {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith("data:")) return; // skips ": OPENROUTER PROCESSING" keep-alives
    const data = trimmedLine.slice(5).trim();
    if (data === "[DONE]") return;
    try {
      const evt = JSON.parse(data) as {
        choices?: { delta?: { content?: string } }[];
        error?: { message?: string };
      };
      if (evt.error?.message) {
        controller.enqueue(encoder.encode(`\n\n[Error: ${evt.error.message}]`));
        return;
      }
      const piece = evt.choices?.[0]?.delta?.content;
      if (piece) controller.enqueue(encoder.encode(piece));
    } catch { /* ignore partial or non-JSON lines */ }
  }
}
