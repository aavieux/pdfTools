"""Maria's PDF Tools — API server. Serves the web app and runs the tools that need real engines."""

import asyncio
import json
import os
import shutil
import subprocess
import threading
from pathlib import Path

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool as bg
from starlette.middleware.gzip import GZipMiddleware

from . import convert, einvoice, pdfops, util
from .util import Workdir, ext, file_response, isolated, release_memory, save_upload, stem

MAX_UPLOAD = int(os.environ.get("MAX_UPLOAD_MB", "300")) * 1024 * 1024
WEB_DIR = Path(__file__).resolve().parent.parent / "web"

app = FastAPI(title="Maria's PDF Tools", docs_url=None, redoc_url=None)


class StaticGZip(GZipMiddleware):
    """Gzip the app's own files (JS/CSS/fonts: ~3 MB → ~1 MB, quicker over the VPN), but not the
    tool results — PDFs and images barely shrink and it would only cost the NAS CPU time."""

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


app.add_middleware(StaticGZip, minimum_size=1024)


class CancelOnDisconnect:
    """Raise the request's cancel flag (util.CANCEL) when the browser goes away, so engines and
    helper processes working for it are stopped instead of keeping the NAS busy for nothing."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return
        cancel = threading.Event()
        body_done = asyncio.Event()

        async def receive_wrapper():
            message = await receive()
            if message["type"] == "http.request" and not message.get("more_body"):
                body_done.set()
            elif message["type"] == "http.disconnect":
                cancel.set()
            return message

        async def watch():
            # Once the upload is complete, the only thing left to hear from the browser is "gone".
            await body_done.wait()
            while (await receive())["type"] != "http.disconnect":
                pass
            cancel.set()

        token = util.CANCEL.set(cancel)
        watcher = asyncio.create_task(watch())
        try:
            await self.app(scope, receive_wrapper, send)
        finally:
            watcher.cancel()
            util.CANCEL.reset(token)


@app.middleware("http")
async def limit_upload(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_UPLOAD:
        return JSONResponse({"detail": f"File too large (limit {MAX_UPLOAD // 1024 // 1024} MB)."}, status_code=413)
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        release_memory()
    elif "Cache-Control" not in response.headers:
        # Re-check the app files on every load (cheap 304s thanks to ETags), so an update
        # never mixes new pages with old cached scripts.
        response.headers["Cache-Control"] = "no-cache"
    return response


def _json_field(raw: str | None, default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError as err:
        raise HTTPException(400, "Invalid JSON in request.") from err


def _bool(v: str | bool | None) -> bool:
    return str(v).lower() in ("1", "true", "yes", "on")


# --------------------------------------------------------------------------- info

@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/info")
def info():
    langs = []
    try:
        out = subprocess.run(["tesseract", "--list-langs"], capture_output=True, text=True, timeout=20).stdout
        langs = [l.strip() for l in out.splitlines()[1:] if l.strip() and l.strip() != "osd"]
    except Exception:
        pass
    return {"ocr_languages": langs, "max_upload_mb": MAX_UPLOAD // 1024 // 1024,
            "memory": {"ram_mb": util.RAM_MB, "low_ram_mode": util.LOW_RAM, "heavy_jobs": util.HEAVY_LIMIT,
                       "ocr_threads": util.OCR_THREADS},
            "engines": {k: bool(shutil.which(v)) for k, v in
                        {"libreoffice": "soffice", "ghostscript": "gs", "qpdf": "qpdf", "tesseract": "tesseract"}.items()}}


# --------------------------------------------------------------------------- conversions

@app.post("/api/convert/to-pdf")
async def to_pdf(file: UploadFile = File(...)):
    with Workdir() as wd:
        src = await save_upload(file, wd)
        data = await bg(convert.to_pdf, src, wd)
        return file_response(data, f"{stem(file.filename)}.pdf")


@app.post("/api/convert/from-pdf")
async def from_pdf(file: UploadFile = File(...), target: str = Form(...)):
    with Workdir() as wd:
        src = await save_upload(file, wd, "input.pdf")
        src = src.rename(wd.file(f"{stem(file.filename)}.pdf"))
        # pdf2docx (OpenCV) and pymupdf4llm (ONNX) are big: run them in a helper process.
        data, name, kind = await bg(isolated, convert.from_pdf, src, target, wd)
        return file_response(data, name, kind)


@app.post("/api/html-to-pdf")
def html_to_pdf(payload: dict = Body(...)):
    html = payload.get("html")
    if not html:
        raise HTTPException(400, "No HTML given.")
    data = convert.html_to_pdf(html, fmt=payload.get("format") or "A4", landscape=bool(payload.get("landscape")),
                               margin=payload.get("margin"), css_page_size=payload.get("css_page_size", True))
    return file_response(data, f"{payload.get('name') or 'document'}.pdf")


@app.post("/api/images/convert")
async def images_convert(file: UploadFile = File(...), to: str = Form("png"), quality: int = Form(90)):
    with Workdir() as wd:
        src = await save_upload(file, wd)
        # Photoshop files need psd-tools + NumPy/SciPy: keep those out of the server's memory.
        runner = isolated if ext(src.name) in ("psd", "psb") else (lambda fn, *a: fn(*a))
        data, name, kind = await bg(runner, convert.convert_image, src, to, quality)
        return file_response(data, name, kind)


def _target_bytes(target: str | None, unit: str | None) -> int:
    """'1.5' + 'MB' → bytes. Empty or 0 means no target."""
    try:
        value = float(target or 0)
    except ValueError as err:
        raise HTTPException(400, "The target size must be a number.") from err
    return int(value * (1024 * 1024 if (unit or "").upper() == "MB" else 1024))


@app.post("/api/images/compress")
async def images_compress(file: UploadFile = File(...), level: str = Form("medium"), target: str = Form(""),
                          unit: str = Form("KB"), max_side: int = Form(0)):
    with Workdir() as wd:
        src = await save_upload(file, wd)
        data, name, kind, headers = await bg(convert.compress_image, src, level, _target_bytes(target, unit), max(0, max_side))
        return file_response(data, name, kind, headers=headers)


# --------------------------------------------------------------------------- optimize & repair

@app.post("/api/compress")
async def compress(file: UploadFile = File(...), level: str = Form("medium"), grayscale: str = Form("false"),
                   target: str = Form(""), unit: str = Form("MB")):
    with Workdir() as wd:
        src = await save_upload(file, wd, "in.pdf")
        target_bytes = _target_bytes(target, unit)
        if target_bytes:
            data, headers = await bg(pdfops.compress_to_size, src, wd, target_bytes, _bool(grayscale))
        else:
            data, headers = await bg(pdfops.compress, src, wd, level, _bool(grayscale))
        return file_response(data, f"{stem(file.filename)}-compressed.pdf", headers=headers)


@app.post("/api/linearize")
async def linearize(file: UploadFile = File(...)):
    with Workdir() as wd:
        src = await save_upload(file, wd, "in.pdf")
        return file_response(await bg(pdfops.linearize, src, wd), f"{stem(file.filename)}-web.pdf")


@app.post("/api/ocr")
async def ocr(file: UploadFile = File(...), langs: str = Form("eng"), mode: str = Form("skip"),
              deskew: str = Form("false"), rotate: str = Form("true"), clean: str = Form("false"), output: str = Form("pdf")):
    with Workdir() as wd:
        src = await save_upload(file, wd)
        if ext(src.name) != "pdf":  # scanned images: wrap them in a PDF first
            pdf = wd.file("in.pdf")
            pdf.write_bytes(await bg(convert.images_to_pdf, [src]))
            src = pdf
        output = output if output in ("pdf", "pdfa") else "pdf"
        data = await bg(pdfops.ocr, src, wd, langs, mode, _bool(deskew), _bool(rotate), _bool(clean), output)
        return file_response(data, f"{stem(file.filename)}-ocr.pdf")


@app.post("/api/repair")
async def repair(file: UploadFile = File(...)):
    with Workdir() as wd:
        src = await save_upload(file, wd, "in.pdf")
        data, method = await bg(pdfops.repair, src, wd)
        return file_response(data, f"{stem(file.filename)}-repaired.pdf", headers={"X-Repair-Method": method})


@app.post("/api/flatten")
async def flatten(file: UploadFile = File(...), mode: str = Form("all")):
    with Workdir() as wd:
        src = await save_upload(file, wd, "in.pdf")
        return file_response(await bg(pdfops.flatten, src, mode), f"{stem(file.filename)}-flat.pdf")


@app.post("/api/pdfa")
async def pdfa(file: UploadFile = File(...), part: str = Form("2"), ocr: str = Form("false")):
    with Workdir() as wd:
        src = await save_upload(file, wd, "in.pdf")
        part = part if part in ("1", "2", "3") else "2"
        return file_response(await bg(pdfops.pdfa, src, wd, part, _bool(ocr)), f"{stem(file.filename)}-pdfa.pdf")


@app.post("/api/verify-signatures")
async def verify_signatures(file: UploadFile = File(...)):
    with Workdir() as wd:
        return await bg(pdfops.verify_signatures, await save_upload(file, wd, "in.pdf"))


# --------------------------------------------------------------------------- security

@app.post("/api/protect")
async def protect(file: UploadFile = File(...), user_password: str = Form(""), owner_password: str = Form(""),
                  allow: str = Form("{}")):
    with Workdir() as wd:
        src = await save_upload(file, wd, "in.pdf")
        data = await bg(pdfops.protect, src, user_password, owner_password, _json_field(allow, {}))
        return file_response(data, f"{stem(file.filename)}-protected.pdf")


@app.post("/api/unlock")
async def unlock(file: UploadFile = File(...), password: str = Form("")):
    with Workdir() as wd:
        src = await save_upload(file, wd, "in.pdf")
        return file_response(await bg(pdfops.unlock, src, password), f"{stem(file.filename)}-unlocked.pdf")


@app.post("/api/remove-metadata")
async def remove_metadata(file: UploadFile = File(...)):
    with Workdir() as wd:
        src = await save_upload(file, wd, "in.pdf")
        return file_response(await bg(pdfops.remove_metadata, src), f"{stem(file.filename)}-clean.pdf")


@app.post("/api/redact")
async def redact(file: UploadFile = File(...), areas: str = Form("[]"), terms: str = Form("[]"),
                 images: str = Form("pixels"), scrub: str = Form("true")):
    with Workdir() as wd:
        src = await save_upload(file, wd, "in.pdf")
        data, count = await bg(pdfops.redact, src, _json_field(areas, []), _json_field(terms, []), images, _bool(scrub))
        if not count:
            raise HTTPException(422, "Nothing to redact: mark some areas or enter words that appear in the PDF.")
        return file_response(data, f"{stem(file.filename)}-redacted.pdf", headers={"X-Redactions": str(count)})


# --------------------------------------------------------------------------- organize

@app.post("/api/bookmarks/get")
async def bookmarks_get(file: UploadFile = File(...)):
    with Workdir() as wd:
        return await bg(pdfops.get_bookmarks, await save_upload(file, wd, "in.pdf"))


@app.post("/api/bookmarks/set")
async def bookmarks_set(file: UploadFile = File(...), bookmarks: str = Form("[]")):
    with Workdir() as wd:
        src = await save_upload(file, wd, "in.pdf")
        return file_response(await bg(pdfops.set_bookmarks, src, _json_field(bookmarks, [])), f"{stem(file.filename)}.pdf")


@app.post("/api/extract-images")
async def extract_images(file: UploadFile = File(...), min_size: int = Form(32), format: str = Form("original")):
    with Workdir() as wd:
        src = await save_upload(file, wd, "in.pdf")
        data, count = await bg(pdfops.extract_images, src, min_size, format)
        return file_response(data, f"{stem(file.filename)}-images.zip", headers={"X-Image-Count": str(count)})


@app.post("/api/blocks")
async def blocks(file: UploadFile = File(...)):
    with Workdir() as wd:
        return await bg(pdfops.text_blocks, await save_upload(file, wd, "in.pdf"))


# --------------------------------------------------------------------------- e-invoices

@app.post("/api/einvoice/xml")
def einvoice_xml(payload: dict = Body(...)):
    model = payload.get("invoice") or {}
    fmt = payload.get("format") or "xrechnung-cii"
    xml = einvoice.generate_xml(model, "ubl" if fmt.endswith("ubl") else "cii", fmt.startswith("xrechnung"))
    return file_response(xml, f"{stem(model.get('number') or 'invoice')}-{fmt}.xml", "xml")


@app.post("/api/einvoice/zugferd")
async def einvoice_zugferd(data: str = Form(...), file: UploadFile | None = File(None), html: str = Form("")):
    model = _json_field(data, {})
    xml = await bg(einvoice.generate_xml, model, "cii", False)
    with Workdir() as wd:
        if file is not None:
            pdf_path = await save_upload(file, wd, "invoice.pdf")
        elif html:
            pdf_path = wd.file("invoice.pdf")
            pdf_path.write_bytes(await bg(convert.html_to_pdf, html))
        else:
            pdf_path = wd.file("invoice.pdf")
            pdf_path.write_bytes(await bg(convert.html_to_pdf, einvoice.render_html(einvoice.to_en16931(model, False))))
        # ZUGFeRD wants a PDF/A-3 container; fall back to the plain PDF if conversion fails.
        try:
            base = await bg(pdfops.pdfa, pdf_path, wd, "3", False)
        except HTTPException:
            base = pdf_path.read_bytes()
        out = await bg(einvoice.embed_zugferd, base, xml)
        return file_response(out, f"{stem(model.get('number') or 'invoice')}-zugferd.pdf")


@app.post("/api/einvoice/read")
async def einvoice_read(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "The file is empty.")
    return await bg(einvoice.read_invoice, raw, file.filename or "")


@app.post("/api/einvoice/to-pdf")
async def einvoice_to_pdf(file: UploadFile = File(...), with_report: str = Form("false")):
    raw = await file.read()
    report = await bg(einvoice.read_invoice, raw, file.filename or "")
    html = await bg(einvoice.render_html, report["data"], report if _bool(with_report) else None)
    return file_response(await bg(convert.html_to_pdf, html), f"{stem(file.filename)}-readable.pdf")


@app.post("/api/einvoice/guess")
async def einvoice_guess(file: UploadFile = File(...)):
    import pymupdf
    raw = await file.read()
    try:
        text = "\n".join(p.get_text() for p in pymupdf.open(stream=raw, filetype="pdf"))
    except Exception:
        text = ""
    return await bg(einvoice.guess_from_text, text)


@app.exception_handler(Exception)
async def unexpected(request: Request, exc: Exception):  # pragma: no cover - safety net
    import logging
    logging.getLogger("uvicorn.error").exception("Unhandled error on %s", request.url.path)
    return JSONResponse({"detail": f"Something went wrong on the server: {exc}"}, status_code=500)


# --------------------------------------------------------------------------- web app

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response((WEB_DIR / "favicon.svg").read_bytes(), media_type="image/svg+xml")


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
app.add_middleware(CancelOnDisconnect)  # added last = outermost, so it sees the raw connection
