// WA Chat Recap — browser logic. Compiled to public/app.js by `npm run build`.

const MAX_FILE_BYTES = 4 * 1024 * 1024; // Vercel's request body limit is 4.5 MB

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const form = $<HTMLFormElement>("form");
const fileInput = $<HTMLInputElement>("chat-file");
const fileMeta = $<HTMLSpanElement>("file-meta");
const passwordInput = $<HTMLInputElement>("password");
const submitBtn = $<HTMLButtonElement>("submit");
const stopBtn = $<HTMLButtonElement>("stop");
const copyBtn = $<HTMLButtonElement>("copy");
const statusEl = $<HTMLParagraphElement>("status");
const output = $<HTMLDivElement>("result");

let ctl: AbortController | null = null;
let lastText = "";

try { passwordInput.value = localStorage.getItem("wa-recap-pw") ?? ""; } catch { /* storage blocked */ }

function setStatus(msg: string, tone: "info" | "error" = "info"): void {
  statusEl.textContent = msg;
  statusEl.dataset.tone = tone;
  statusEl.hidden = msg === "";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

// Minimal markdown: headings, bold, bullets, numbered lists, paragraphs.
function renderMarkdown(md: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (list !== kind) { close(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
    } else if (h) {
      close(); out.push(`<h3>${inline(h[1])}</h3>`);
    } else if (/^\s*\*\*[^*]+\*\*:?\s*$/.test(line)) {
      close(); out.push(`<h3>${inline(line.trim())}</h3>`);
    } else if (line.trim() === "") {
      close();
    } else {
      close(); out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return out.join("");
}

function showResult(text: string): void {
  lastText = text;
  output.innerHTML = renderMarkdown(text);
  output.dataset.state = "filled";
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  fileMeta.textContent = f ? `${f.name} · ${formatSize(f.size)}` : "No file chosen";
  setStatus("");
});

stopBtn.addEventListener("click", () => ctl?.abort());

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(lastText);
    copyBtn.textContent = "Copied";
  } catch {
    const range = document.createRange();
    range.selectNodeContents(output);
    const sel = window.getSelection();
    sel?.removeAllRanges(); sel?.addRange(range);
    copyBtn.textContent = "Selected, press Ctrl+C";
  }
  setTimeout(() => (copyBtn.textContent = "Copy summary"), 2000);
});

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const file = fileInput.files?.[0];
  if (!file) { setStatus("Choose a WhatsApp .txt export first.", "error"); return; }
  if (!/\.txt$/i.test(file.name) && file.type !== "text/plain") {
    setStatus("That file isn't a .txt export. In WhatsApp, use Export chat → Without media.", "error");
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    setStatus("This file is over 4 MB. Export a shorter range of the chat.", "error");
    return;
  }

  const chat = (await file.text()).trim();
  if (!chat) { setStatus("The file is empty.", "error"); return; }

  try { localStorage.setItem("wa-recap-pw", passwordInput.value); } catch { /* storage blocked */ }

  ctl = new AbortController();
  submitBtn.disabled = true;
  stopBtn.hidden = false;
  copyBtn.hidden = true;
  output.dataset.state = "loading";
  output.textContent = "Thinking…";
  setStatus("");

  try {
    const res = await fetch("/api/summarize", {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-password": passwordInput.value },
      body: JSON.stringify({ chat }),
      signal: ctl.signal,
    });

    if (!res.ok || !res.body) {
      let msg = `Request failed (${res.status}).`;
      try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* not JSON */ }
      output.textContent = "";
      output.dataset.state = "empty";
      setStatus(msg, "error");
      return;
    }
    if (res.headers.get("x-chat-trimmed") === "1") {
      setStatus("Chat was long, so only the most recent messages were summarized.");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.trim()) showResult(text);
    }
    text += decoder.decode();
    if (text.trim()) {
      showResult(text);
      copyBtn.hidden = false;
    } else {
      output.textContent = "";
      output.dataset.state = "empty";
      setStatus("The model returned an empty summary. Try again.", "error");
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") setStatus("Stopped.");
    else setStatus("Connection lost before the summary finished. Submit again to retry.", "error");
    if (lastText.trim()) copyBtn.hidden = false;
  } finally {
    submitBtn.disabled = false;
    stopBtn.hidden = true;
    ctl = null;
  }
});
