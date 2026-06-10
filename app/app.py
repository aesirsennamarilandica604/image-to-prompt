import argparse
import io
import json
import os
import re
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
DEFAULT_MODEL = os.environ.get("FLORENCE_MODEL", "microsoft/Florence-2-base-ft")
MOCK_MODE = os.environ.get("IMAGE_TO_PROMPT_MOCK", "").lower() in {"1", "true", "yes"}

app = FastAPI(title="Image to Prompt", version="1.0.0")


class NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope: dict[str, Any]):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store, max-age=0"
        return response


@dataclass
class FlorenceRuntime:
    model: Any
    processor: Any
    torch: Any
    device: str
    dtype: Any


runtime_lock = threading.Lock()
runtime: FlorenceRuntime | None = None


def log_progress(request_id: str | None, message: str) -> None:
    prefix = "[Image to Prompt]"
    if request_id:
        prefix += f"[{request_id}]"
    print(f"{prefix} {message}", flush=True)


@contextmanager
def progress_stage(request_id: str | None, label: str):
    started_at = time.perf_counter()
    log_progress(request_id, f"{label}...")
    try:
        yield
    except Exception:
        elapsed = time.perf_counter() - started_at
        log_progress(request_id, f"{label} failed after {elapsed:.1f}s")
        raise
    else:
        elapsed = time.perf_counter() - started_at
        log_progress(request_id, f"{label} done in {elapsed:.1f}s")


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))


def image_to_bytes(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def load_image(data: bytes) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Upload a valid image file.") from exc
    if image.width < 1 or image.height < 1:
        raise HTTPException(status_code=400, detail="Upload a non-empty image.")
    return image


def normalize_bbox_xyxy(box: list[float], width: int, height: int) -> list[int]:
    x1, y1, x2, y2 = [float(v) for v in box[:4]]
    x1 = clamp(x1, 0, width)
    x2 = clamp(x2, 0, width)
    y1 = clamp(y1, 0, height)
    y2 = clamp(y2, 0, height)
    if x2 < x1:
        x1, x2 = x2, x1
    if y2 < y1:
        y1, y2 = y2, y1
    return [
        round((y1 / height) * 1000),
        round((x1 / width) * 1000),
        round((y2 / height) * 1000),
        round((x2 / width) * 1000),
    ]


def bbox_area(bbox: list[int]) -> int:
    y1, x1, y2, x2 = bbox
    return max(0, y2 - y1) * max(0, x2 - x1)


def bbox_iou(a: list[int], b: list[int]) -> float:
    ay1, ax1, ay2, ax2 = a
    by1, bx1, by2, bx2 = b
    iy1, ix1 = max(ay1, by1), max(ax1, bx1)
    iy2, ix2 = min(ay2, by2), min(ax2, bx2)
    inter = bbox_area([iy1, ix1, iy2, ix2])
    denom = bbox_area(a) + bbox_area(b) - inter
    return inter / denom if denom else 0.0


def slug_label(label: str) -> str:
    label = re.sub(r"</?s>|<pad>|</?[^>]+>", " ", label or "", flags=re.IGNORECASE)
    label = re.sub(r"^\s*s>\s*", "", label, flags=re.IGNORECASE)
    label = re.sub(r"\s+", " ", label or "").strip()
    label = re.sub(r"^[\W_]+|[\W_]+$", "", label)
    return label or "object"


def sample_color(image: Image.Image, bbox: list[int]) -> str:
    y1, x1, y2, x2 = bbox
    left = int((x1 / 1000) * image.width)
    top = int((y1 / 1000) * image.height)
    right = max(left + 1, int((x2 / 1000) * image.width))
    bottom = max(top + 1, int((y2 / 1000) * image.height))
    crop = image.crop((left, top, right, bottom)).resize((1, 1), Image.Resampling.BILINEAR)
    r, g, b = crop.getpixel((0, 0))
    return f"#{r:02X}{g:02X}{b:02X}"


def dominant_palette(image: Image.Image, count: int = 5) -> list[str]:
    small = image.resize((80, 80), Image.Resampling.BILINEAR)
    arr = np.asarray(small).reshape(-1, 3)
    if arr.size == 0:
        return []
    bins = np.clip((arr // 32) * 32 + 16, 0, 255).astype(np.uint8)
    colors, counts = np.unique(bins, axis=0, return_counts=True)
    order = np.argsort(counts)[::-1][:count]
    return [f"#{r:02X}{g:02X}{b:02X}" for r, g, b in colors[order]]


def build_ideogram_json(
    caption: str,
    background: str,
    elements: list[dict[str, Any]],
    palette: list[str],
) -> dict[str, Any]:
    clean_caption = caption.strip() or "Uploaded image scene."
    bg = background.strip() or "Background and setting inferred from the uploaded image."
    ordered = []
    for idx, item in enumerate(elements, start=1):
        item_type = item.get("type") if item.get("type") in {"obj", "text"} else "obj"
        bbox = [int(value) for value in item["bbox"][:4]]
        desc = (item.get("description") or item.get("label") or f"object {idx}").strip()
        if item_type == "text":
            text = (item.get("text") or item.get("label") or desc).strip()
            ordered.append(
                {
                    "type": "text",
                    "bbox": bbox,
                    "text": text,
                    "desc": desc or f"Text reading '{text}'.",
                }
            )
        else:
            ordered.append(
                {
                    "type": "obj",
                    "bbox": bbox,
                    "desc": desc,
                }
            )
    return {
        "high_level_description": clean_caption,
        "compositional_deconstruction": {
            "background": bg,
            "elements": ordered,
        },
    }


def get_runtime(request_id: str | None = None) -> FlorenceRuntime:
    global runtime
    if runtime is not None:
        return runtime
    with runtime_lock:
        if runtime is not None:
            return runtime
        if MOCK_MODE:
            raise RuntimeError("Mock mode does not load Florence-2.")

        with progress_stage(request_id, f"Loading Florence-2 runtime ({DEFAULT_MODEL})"):
            import torch
            from transformers import AutoModelForCausalLM, AutoProcessor

            if torch.cuda.is_available():
                device = "cuda"
                dtype = torch.float16
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                device = "mps"
                dtype = torch.float32
                # Cap Metal allocations so a runaway request raises an error
                # instead of exhausting unified memory and freezing the machine.
                torch.mps.set_per_process_memory_fraction(0.5)
            else:
                device = "cpu"
                dtype = torch.float32

            log_progress(request_id, f"Using device={device}, dtype={dtype}")
            model = AutoModelForCausalLM.from_pretrained(
                DEFAULT_MODEL,
                trust_remote_code=True,
                torch_dtype=dtype,
            ).to(device)
            model.eval()
            processor = AutoProcessor.from_pretrained(DEFAULT_MODEL, trust_remote_code=True)
        runtime = FlorenceRuntime(model=model, processor=processor, torch=torch, device=device, dtype=dtype)
        return runtime


def release_accelerator_cache(rt: FlorenceRuntime) -> None:
    if rt.device == "mps":
        rt.torch.mps.empty_cache()
    elif rt.device == "cuda":
        rt.torch.cuda.empty_cache()


def run_florence_task(image: Image.Image, task: str, label: str, request_id: str) -> dict[str, Any]:
    with progress_stage(request_id, label):
        rt = get_runtime(request_id)
        inputs = rt.processor(text=task, images=image, return_tensors="pt")
        moved: dict[str, Any] = {}
        for key, value in inputs.items():
            if hasattr(value, "to"):
                value = value.to(rt.device)
                if key == "pixel_values":
                    value = value.to(rt.dtype)
            moved[key] = value
        try:
            with rt.torch.inference_mode():
                generated_ids = rt.model.generate(
                    input_ids=moved["input_ids"],
                    pixel_values=moved["pixel_values"],
                    max_new_tokens=1024,
                    num_beams=3,
                    early_stopping=False,
                )
            generated_text = rt.processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
            result = rt.processor.post_process_generation(generated_text, task=task, image_size=(image.width, image.height))
            del generated_ids
            return result
        finally:
            # The MPS allocator never returns generation buffers to the OS on its own;
            # without this, sequential analyses accumulate tens of GB of Metal memory.
            del inputs, moved
            release_accelerator_cache(rt)


def extract_task_value(result: dict[str, Any], task: str) -> Any:
    if task in result:
        return result[task]
    return next(iter(result.values()), None)


def parse_florence(image: Image.Image, request_id: str) -> tuple[str, str, list[dict[str, Any]]]:
    caption_result = extract_task_value(
        run_florence_task(image, "<MORE_DETAILED_CAPTION>", "Generating detailed caption", request_id),
        "<MORE_DETAILED_CAPTION>",
    )
    caption = caption_result if isinstance(caption_result, str) else ""

    dense_result = extract_task_value(
        run_florence_task(image, "<DENSE_REGION_CAPTION>", "Detecting dense regions", request_id),
        "<DENSE_REGION_CAPTION>",
    )
    od_result = extract_task_value(run_florence_task(image, "<OD>", "Detecting objects", request_id), "<OD>")
    ocr_result = extract_task_value(
        run_florence_task(image, "<OCR_WITH_REGION>", "Running OCR with regions", request_id),
        "<OCR_WITH_REGION>",
    )

    dense_items = []
    if isinstance(dense_result, dict):
        for label, box in zip(dense_result.get("labels", []), dense_result.get("bboxes", []), strict=False):
            bbox = normalize_bbox_xyxy(box, image.width, image.height)
            if bbox_area(bbox) > 40:
                dense_items.append({"label": slug_label(label), "description": slug_label(label), "bbox": bbox})

    elements: list[dict[str, Any]] = []
    if isinstance(od_result, dict):
        for label, box in zip(od_result.get("labels", []), od_result.get("bboxes", []), strict=False):
            bbox = normalize_bbox_xyxy(box, image.width, image.height)
            if bbox_area(bbox) <= 40:
                continue
            desc = slug_label(label)
            best_dense = max(dense_items, key=lambda item: bbox_iou(bbox, item["bbox"]), default=None)
            if best_dense and bbox_iou(bbox, best_dense["bbox"]) > 0.2:
                desc = best_dense["description"]
            elements.append(
                {
                    "id": f"item-{len(elements) + 1}",
                    "type": "obj",
                    "label": slug_label(label),
                    "description": desc,
                    "bbox": bbox,
                    "color": sample_color(image, bbox),
                }
            )

    if not elements:
        for item in dense_items[:20]:
            elements.append(
                {
                    "id": f"item-{len(elements) + 1}",
                    "type": "obj",
                    "label": item["label"],
                    "description": item["description"],
                    "bbox": item["bbox"],
                    "color": sample_color(image, item["bbox"]),
                }
            )

    if isinstance(ocr_result, dict):
        quad_boxes = ocr_result.get("quad_boxes", []) or ocr_result.get("bboxes", [])
        for label, box in zip(ocr_result.get("labels", []), quad_boxes, strict=False):
            coords = [float(v) for v in box]
            if len(coords) >= 8:
                xs = coords[0::2]
                ys = coords[1::2]
                xyxy = [min(xs), min(ys), max(xs), max(ys)]
            else:
                xyxy = coords[:4]
            bbox = normalize_bbox_xyxy(xyxy, image.width, image.height)
            text = slug_label(label)
            if bbox_area(bbox) > 20 and text:
                elements.append(
                    {
                        "id": f"item-{len(elements) + 1}",
                        "type": "text",
                        "label": text,
                        "text": text,
                        "description": f'text "{text}"',
                        "bbox": bbox,
                        "color": sample_color(image, bbox),
                    }
                )

    seen: list[dict[str, Any]] = []
    for element in sorted(elements, key=lambda item: (item["bbox"][0], item["bbox"][1])):
        duplicate = any(bbox_iou(element["bbox"], other["bbox"]) > 0.85 and element["label"] == other["label"] for other in seen)
        if not duplicate:
            element["id"] = f"item-{len(seen) + 1}"
            seen.append(element)
    background = caption or "Background and setting inferred from the uploaded image."
    return caption, background, seen[:40]


def mock_parse(image: Image.Image) -> tuple[str, str, list[dict[str, Any]]]:
    caption = "Four cats resting together on a sofa in a softly lit room."
    boxes = [
        [290, 70, 720, 300],
        [260, 290, 760, 510],
        [270, 500, 740, 730],
        [300, 700, 760, 930],
    ]
    elements = []
    for idx, bbox in enumerate(boxes, start=1):
        elements.append(
            {
                "id": f"item-{idx}",
                "type": "obj",
                "label": f"cat {idx}",
                "description": f"cat {idx}",
                "bbox": bbox,
                "color": sample_color(image, bbox),
            }
        )
    return caption, "A sofa and room background behind the four cats.", elements


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "model": DEFAULT_MODEL,
        "mock": MOCK_MODE,
        "loaded": runtime is not None,
    }


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)) -> JSONResponse:
    request_id = uuid.uuid4().hex[:8]
    started_at = time.perf_counter()
    log_progress(request_id, f"Analysis request received: {file.filename or 'uploaded image'}")
    if not file.content_type or not file.content_type.startswith("image/"):
        log_progress(request_id, f"Rejected upload with content_type={file.content_type!r}")
        raise HTTPException(status_code=400, detail="Upload an image file.")
    try:
        with progress_stage(request_id, "Reading uploaded image"):
            image = load_image(await file.read())
            log_progress(request_id, f"Image size: {image.width}x{image.height}")

        if MOCK_MODE:
            with progress_stage(request_id, "Running mock parser"):
                caption, background, elements = mock_parse(image)
        else:
            caption, background, elements = parse_florence(image, request_id)

        with progress_stage(request_id, "Building Ideogram JSON"):
            palette = dominant_palette(image)
            prompt_json = build_ideogram_json(caption, background, elements, palette)
    except HTTPException:
        log_progress(request_id, "Analysis failed with HTTP error")
        raise
    except Exception as exc:  # noqa: BLE001
        log_progress(request_id, f"Analysis failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Florence-2 analysis failed: {exc}") from exc

    elapsed = time.perf_counter() - started_at
    log_progress(request_id, f"Analysis complete: {len(elements)} elements in {elapsed:.1f}s")
    return JSONResponse(
        {
            "image": {"width": image.width, "height": image.height},
            "model": "mock" if MOCK_MODE else DEFAULT_MODEL,
            "caption": caption,
            "background": background,
            "palette": palette,
            "elements": elements,
            "json": prompt_json,
        }
    )


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-store, max-age=0"})


app.mount("/static", NoCacheStaticFiles(directory=STATIC_DIR), name="static")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", default=int(os.environ.get("PORT", "7860")), type=int)
    args = parser.parse_args()
    print(f"Image to Prompt running at http://{args.host}:{args.port}", flush=True)
    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
