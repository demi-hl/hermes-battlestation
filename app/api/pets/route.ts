import { NextResponse } from "next/server";
import { writeFile, unlink } from "node:fs/promises";
import nodeOs from "node:os";
import path from "node:path";
import { run, scrubPaths, shellQuote } from "@/lib/exec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function runPython(script: string, timeoutMs = 30_000) {
  const file = path.join(nodeOs.tmpdir(), `battlestation-pets-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.py`);
  await writeFile(file, script, "utf8");
  try {
    return await run(`python3 ${shellQuote(file)}`, { timeoutMs });
  } finally {
    await unlink(file).catch(() => {});
  }
}

function pyPrelude(payload: unknown) {
  return String.raw`
import base64, io, json, sys
params = ${JSON.stringify(payload)}

def emit(obj):
    print(json.dumps(obj, ensure_ascii=False))

try:
    from agent.pet import constants, store
    from agent.pet.manifest import fetch_manifest
    from hermes_cli.config import load_config
except Exception as exc:
    emit({"ok": False, "error": f"pet modules unavailable: {exc}"})
    sys.exit(0)

def pet_config():
    try:
        cfg = load_config()
        display = cfg.get("display", {}) if isinstance(cfg.get("display"), dict) else {}
        return display.get("pet", {}) if isinstance(display.get("pet"), dict) else {}
    except Exception:
        return {}

def active_info():
    cfg = pet_config()
    enabled = bool(cfg.get("enabled"))
    configured_slug = str(cfg.get("slug", "") or "")
    pet = store.resolve_active_pet(configured_slug) if enabled else None
    if not enabled or pet is None or not pet.exists:
        return {"enabled": False, "id": "none", "label": "Status dot", "frames": []}
    try:
        from PIL import Image
        from agent.pet import render
        with Image.open(pet.spritesheet) as image:
            im = image.convert("RGBA")
            rows = max(1, im.height // constants.FRAME_H)
            cols = max(1, im.width // constants.FRAME_W)
            row = constants.state_row_index("idle", rows)
            try:
                counts = render.state_frame_counts(str(pet.spritesheet))
            except Exception:
                counts = {}
            count = int(counts.get("idle") or constants.FRAMES_PER_STATE or 1)
            count = max(1, min(count, cols))
            frames = []
            for i in range(count):
                frame = im.crop((
                    i * constants.FRAME_W,
                    row * constants.FRAME_H,
                    min((i + 1) * constants.FRAME_W, im.width),
                    min((row + 1) * constants.FRAME_H, im.height),
                ))
                buf = io.BytesIO()
                frame.save(buf, format="PNG")
                frames.append("data:image/png;base64," + base64.standard_b64encode(buf.getvalue()).decode("ascii"))
        return {
            "enabled": True,
            "id": pet.slug,
            "label": pet.display_name,
            "frames": frames,
            "loopMs": constants.LOOP_MS,
            "frameW": constants.FRAME_W,
            "frameH": constants.FRAME_H,
        }
    except Exception as exc:
        return {"enabled": False, "id": "none", "label": "Status dot", "frames": [], "error": str(exc)}

def tight_thumb_png(data, size=128, pad=6):
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert("RGBA")
        bbox = im.getbbox()
        if not bbox:
            return data
        crop = im.crop(bbox)
        max_w = max(1, size - pad * 2)
        max_h = max(1, size - pad * 2)
        scale = min(max_w / max(1, crop.width), max_h / max(1, crop.height))
        w = max(1, int(round(crop.width * scale)))
        h = max(1, int(round(crop.height * scale)))
        crop = crop.resize((w, h), Image.NEAREST)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.alpha_composite(crop, ((size - w) // 2, (size - h) // 2))
        buf = io.BytesIO()
        canvas.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:
        return data
`;
}

async function jsonFromPython(script: string, timeoutMs = 30_000, status = 200) {
  const res = await runPython(script, timeoutMs);
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: scrubPaths(res.stderr || res.stdout || "pet command failed").slice(0, 800) },
      { status: 500 },
    );
  }
  try {
    return NextResponse.json(JSON.parse(res.stdout.trim()), { status });
  } catch {
    return NextResponse.json(
      { ok: false, error: "pet response parse failed", detail: scrubPaths(res.stdout).slice(0, 800) },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "info";

  if (mode === "gallery") {
    const query = (url.searchParams.get("query") || "").trim().toLowerCase();
    const limit = Math.max(12, Math.min(120, Number(url.searchParams.get("limit") || 48) || 48));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0);
    const script = `${pyPrelude({ query, limit, offset })}
try:
    cfg = pet_config()
    installed = {p.slug for p in store.installed_pets()}
    active = str(cfg.get("slug", "") or "")
    enabled = bool(cfg.get("enabled"))
    rows = []
    manifest_slugs = set()
    for entry in fetch_manifest():
        slug = entry.slug
        manifest_slugs.add(slug)
        if slug.lower().startswith("clawd-") or slug.lower() == "clawd":
            continue
        display = entry.display_name
        hay = (slug + " " + display).lower()
        if params["query"] and params["query"] not in hay:
            continue
        curated = "/curated/" in entry.spritesheet_url
        rows.append({
            "slug": slug,
            "displayName": display,
            "installed": slug in installed,
            "active": enabled and slug == active,
            "curated": curated,
            "spritesheetUrl": entry.spritesheet_url,
        })
    for pet in store.installed_pets():
        slug = pet.slug
        if slug in manifest_slugs:
            continue
        display = pet.display_name
        hay = (slug + " " + display).lower()
        if params["query"] and params["query"] not in hay:
            continue
        rows.append({
            "slug": slug,
            "displayName": display,
            "installed": True,
            "active": enabled and slug == active,
            "curated": True,
            "spritesheetUrl": "",
        })
    rows.sort(key=lambda p: (not p["active"], not p["installed"], not p["curated"], p["displayName"].lower()))
    total = len(rows)
    start = int(params["offset"])
    end = start + int(params["limit"])
    emit({"ok": True, "enabled": enabled, "active": active, "total": total, "offset": start, "limit": int(params["limit"]), "pets": rows[start:end]})
except Exception as exc:
    emit({"ok": False, "enabled": False, "active": "", "total": 0, "pets": [], "error": str(exc)})
`;
    return jsonFromPython(script, 35_000);
  }

  if (mode === "thumb") {
    const slug = (url.searchParams.get("slug") || "").trim();
    const sourceUrl = (url.searchParams.get("url") || "").trim();
    if (!slug) return NextResponse.json({ ok: false, error: "slug required" }, { status: 400 });
    const script = `${pyPrelude({ slug, sourceUrl })}
try:
    data = store.thumbnail_png(params["slug"], source_url=params.get("sourceUrl", ""), timeout=20.0)
    if not data:
        emit({"ok": False, "slug": params["slug"]})
    else:
        data = tight_thumb_png(data)
        emit({"ok": True, "slug": params["slug"], "dataUri": "data:image/png;base64," + base64.standard_b64encode(data).decode("ascii")})
except Exception as exc:
    emit({"ok": False, "slug": params["slug"], "error": str(exc)})
`;
    return jsonFromPython(script, 25_000);
  }

  const script = `${pyPrelude({})}
emit({"ok": True, "pet": active_info()})
`;
  return jsonFromPython(script, 15_000);
}

export async function POST(req: Request) {
  let body: { action?: string; slug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const action = body.action || "select";
  if (action === "off") {
    const script = `${pyPrelude({})}
try:
    from hermes_cli.pets import _set_enabled
    _set_enabled(False)
    emit({"ok": True, "pet": active_info()})
except Exception as exc:
    emit({"ok": False, "error": str(exc)})
`;
    return jsonFromPython(script, 15_000);
  }

  const slug = (body.slug || "").trim();
  if (!slug) return NextResponse.json({ ok: false, error: "slug required" }, { status: 400 });
  const script = `${pyPrelude({ slug })}
try:
    from hermes_cli.pets import _set_active
    pet = store.load_pet(params["slug"])
    if pet is None or not pet.exists:
        pet = store.install_pet(params["slug"])
    _set_active(pet.slug)
    emit({"ok": True, "pet": active_info()})
except Exception as exc:
    emit({"ok": False, "error": str(exc)})
`;
  return jsonFromPython(script, 45_000);
}
