import { NextResponse } from "next/server";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { run, shellQuote } from "@/lib/exec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Python from the Hermes agent venv has faster_whisper installed. Transcribe a
// short audio clip from the mobile mic (Web Speech is unavailable in the iOS
// WKWebView, so the client records with MediaRecorder and POSTs the blob here).
const PY = `${process.env.HOME}/.hermes/hermes-agent/venv/bin/python`;

// One-shot transcription. Kept tiny (base model, CPU) so a few seconds of speech
// returns fast. Model is cached on disk after first use.
function pyScript(audioPath: string): string {
  return [
    "from faster_whisper import WhisperModel",
    "import sys",
    "m = WhisperModel('base', device='cpu', compute_type='int8')",
    `segs, _ = m.transcribe(${JSON.stringify(audioPath)}, language='en')`,
    "print(' '.join(s.text.strip() for s in segs).strip())",
  ].join("; ");
}

export async function POST(req: Request) {
  let buf: Buffer;
  try {
    const ab = await req.arrayBuffer();
    buf = Buffer.from(ab);
  } catch {
    return NextResponse.json({ error: "no audio" }, { status: 400 });
  }
  if (buf.length === 0) return NextResponse.json({ error: "empty audio" }, { status: 400 });
  if (buf.length > 25 * 1024 * 1024)
    return NextResponse.json({ error: "audio too large" }, { status: 413 });

  const dir = await mkdtemp(join(tmpdir(), "bs-stt-"));
  const raw = join(dir, "in.webm");
  const wav = join(dir, "in.wav");
  try {
    await writeFile(raw, buf);
    // Normalize to 16k mono wav (whisper's native rate) via ffmpeg.
    const conv = await run(
      `ffmpeg -y -i ${shellQuote(raw)} -ar 16000 -ac 1 ${shellQuote(wav)}`,
      { timeoutMs: 30_000 },
    );
    if (!conv.ok) {
      return NextResponse.json(
        { error: "audio decode failed", detail: conv.stderr.slice(-300) },
        { status: 500 },
      );
    }
    const r = await run(`${shellQuote(PY)} -c ${shellQuote(pyScript(wav))}`, {
      timeoutMs: 60_000,
    });
    if (!r.ok) {
      return NextResponse.json(
        { error: "transcription failed", detail: r.stderr.slice(-300) },
        { status: 500 },
      );
    }
    return NextResponse.json({ text: r.stdout.trim() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "transcribe error" },
      { status: 500 },
    );
  } finally {
    await unlink(raw).catch(() => {});
    await unlink(wav).catch(() => {});
  }
}
