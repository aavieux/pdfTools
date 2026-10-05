"""PDF operations that need real engines (Ghostscript, qpdf, OCR, PyMuPDF, pikepdf, pyHanko)."""

import io
import zipfile
from pathlib import Path

import pikepdf
import pymupdf
from fastapi import HTTPException

from .util import OCR_THREADS, Workdir, fail, heavy, run, stem


def _open_mupdf(path: Path):
    try:
        doc = pymupdf.open(path)
    except Exception as err:
        raise HTTPException(422, "This PDF could not be opened. Try “Repair PDF” first.") from err
    if doc.needs_pass:
        raise HTTPException(422, "This PDF is password protected. Unlock it first ♡")
    return doc


def _open_pike(path: Path, password: str = "") -> pikepdf.Pdf:
    try:
        return pikepdf.open(path, password=password)
    except pikepdf.PasswordError as err:
        raise HTTPException(422, "Wrong password." if password else "This PDF is password protected. Unlock it first ♡") from err
    except pikepdf.PdfError as err:
        raise HTTPException(422, f"This PDF could not be opened: {err}. Try “Repair PDF” first.") from err


# --------------------------------------------------------------------------- optimize

COMPRESS_LEVELS = {
    # name: (dpi for colour/gray images, mono dpi, jpeg quality)
    "low": (220, 600, 90),
    "medium": (150, 300, 80),
    "high": (110, 300, 65),
    "extreme": (72, 200, 45),
}

# Settings tried (mildest first) when aiming for a file size.
SIZE_LADDER = [
    (300, 600, 90), (220, 600, 85), (180, 400, 80), (150, 300, 75), (130, 300, 68), (110, 300, 60),
    (96, 250, 52), (84, 200, 45), (72, 200, 38), (60, 150, 32), (50, 150, 26), (40, 120, 20),
]


def _gs_compress(src: Path, wd: Workdir, dpi: int, mono: int, quality: int, grayscale: bool, tidy: bool = True) -> Path:
    """One Ghostscript pass with the given image settings, tidied with qpdf (unless tidy=False).
    Returns the smaller result."""
    out = wd.file(f"gs-{dpi}-{quality}.pdf")
    cmd = [
        "gs", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.6", "-dNOPAUSE", "-dBATCH", "-dQUIET", "-dSAFER",
        "-dPDFSETTINGS=/ebook", "-dDetectDuplicateImages=true", "-dCompressFonts=true", "-dSubsetFonts=true",
        "-dAutoRotatePages=/None",
        "-dDownsampleColorImages=true", f"-dColorImageResolution={dpi}", "-dColorImageDownsampleType=/Bicubic",
        "-dDownsampleGrayImages=true", f"-dGrayImageResolution={dpi}", "-dGrayImageDownsampleType=/Bicubic",
        "-dDownsampleMonoImages=true", f"-dMonoImageResolution={mono}",
        "-dColorImageDownsampleThreshold=1.1", "-dGrayImageDownsampleThreshold=1.1",
        "-dAutoFilterColorImages=false", "-dColorImageFilter=/DCTEncode",
        "-dAutoFilterGrayImages=false", "-dGrayImageFilter=/DCTEncode",
        f"-dJPEGQ={quality}",
    ]
    if grayscale:
        cmd += ["-sColorConversionStrategy=Gray", "-dProcessColorModel=/DeviceGray"]
    cmd += [f"-sOutputFile={out}", str(src)]
    with heavy():
        proc = run(cmd, timeout=600)
    if proc.returncode or not out.exists():
        fail(proc, "Compression")
    return _tidy(out) if tidy else out


def _tidy(pdf: Path) -> Path:
    """Repack with qpdf (object streams) and keep whichever file is smaller."""
    tidy = pdf.with_name(f"tidy-{pdf.name}")
    run(["qpdf", "--object-streams=generate", "--compress-streams=y", "--recompress-flate", str(pdf), str(tidy)], timeout=300)
    candidates = [p for p in (pdf, tidy) if p.exists() and p.stat().st_size]
    return min(candidates, key=lambda p: p.stat().st_size)


def _size_headers(before: int, after: int, note: str = "") -> dict:
    headers = {"X-Original-Size": str(before), "X-New-Size": str(after)}
    if note:
        headers["X-Note"] = note
    return headers


def compress(src: Path, wd: Workdir, level: str = "medium", grayscale: bool = False) -> tuple[bytes, dict]:
    dpi, mono, quality = COMPRESS_LEVELS.get(level, COMPRESS_LEVELS["medium"])
    best = _gs_compress(src, wd, dpi, mono, quality, grayscale)
    before = src.stat().st_size
    after = best.stat().st_size
    if after >= before and not grayscale:
        return src.read_bytes(), _size_headers(before, before, "already-optimal")
    return best.read_bytes(), _size_headers(before, after)


def compress_to_size(src: Path, wd: Workdir, target: int, grayscale: bool = False) -> tuple[bytes, dict]:
    """Find the mildest settings whose result is at most `target` bytes (binary search over SIZE_LADDER)."""
    before = src.stat().st_size
    if before <= target and not grayscale:
        return src.read_bytes(), _size_headers(before, before, "already-small")
    results: dict[int, Path] = {}

    # The search compares raw Ghostscript results (qpdf only shaves off a little); the chosen file
    # is tidied once at the end, which roughly halves the work on a slow NAS.
    def attempt(i: int) -> int:
        if i not in results:
            results[i] = _gs_compress(src, wd, *SIZE_LADDER[i], grayscale, tidy=False)
        return results[i].stat().st_size

    lo, hi = 0, len(SIZE_LADDER) - 1
    if attempt(hi) > target:
        # Even the strongest setting is too big (e.g. mostly text or vector graphics): give the smallest we got.
        smallest = _tidy(min(results.values(), key=lambda p: p.stat().st_size))
        size = smallest.stat().st_size
        if size >= before and not grayscale:
            return src.read_bytes(), _size_headers(before, before, "target-not-reached")
        return smallest.read_bytes(), _size_headers(before, size, "target-not-reached")
    while lo < hi:
        mid = (lo + hi) // 2
        if attempt(mid) <= target:
            hi = mid
        else:
            lo = mid + 1
    best = _tidy(results[lo])
    return best.read_bytes(), _size_headers(before, best.stat().st_size)


def linearize(src: Path, wd: Workdir) -> bytes:
    out = wd.file("web.pdf")
    proc = run(["qpdf", "--linearize", "--object-streams=generate", str(src), str(out)], timeout=300)
    if proc.returncode not in (0, 3) or not out.exists():  # 3 = warnings
        fail(proc, "Web optimization")
    return out.read_bytes()


def ocr(src: Path, wd: Workdir, langs: str = "eng", mode: str = "skip", deskew: bool = False,
        rotate: bool = True, clean: bool = False, output: str = "pdf") -> bytes:
    out = wd.file("ocr.pdf")
    langs = "+".join(l for l in langs.replace(",", "+").split("+") if l.isalpha()) or "eng"
    cmd = ["ocrmypdf", "-l", langs, "--output-type", output, "--jobs", OCR_THREADS, "--optimize", "1"]
    cmd.append({"skip": "--skip-text", "redo": "--redo-ocr", "force": "--force-ocr"}.get(mode, "--skip-text"))
    if deskew and mode == "force":
        cmd.append("--deskew")
    if rotate:
        cmd.append("--rotate-pages")
    if clean and mode == "force":
        cmd.append("--clean")
    cmd += [str(src), str(out)]
    with heavy():
        proc = run(cmd, timeout=1800)
    if proc.returncode not in (0, 10) or not out.exists():  # 10 = PDF/A validation warning
        if proc.returncode == 6:
            raise HTTPException(422, "This PDF already contains text. Choose “Redo OCR” or “Force OCR”.")
        if proc.returncode == 8:
            raise HTTPException(422, "This PDF is password protected. Unlock it first ♡")
        fail(proc, "OCR")
    return out.read_bytes()


def repair(src: Path, wd: Workdir) -> tuple[bytes, str]:
    out = wd.file("repaired.pdf")
    # 1) qpdf/pikepdf rebuild (handles broken xref tables, bad offsets, …)
    try:
        with pikepdf.open(src, attempt_recovery=True) as pdf:
            pdf.save(out)
        if pymupdf.open(out).page_count > 0:
            return out.read_bytes(), "qpdf"
    except Exception:
        pass
    # 2) MuPDF's repair
    try:
        doc = pymupdf.open(src)
        if doc.page_count:
            return doc.tobytes(garbage=3, deflate=True, clean=True), "mupdf"
    except Exception:
        pass
    # 3) Re-interpret everything with Ghostscript
    with heavy():
        proc = run(["gs", "-sDEVICE=pdfwrite", "-dNOPAUSE", "-dBATCH", "-dQUIET", "-dSAFER",
                    f"-sOutputFile={out}", str(src)], timeout=600)
    if out.exists() and out.stat().st_size > 0:
        return out.read_bytes(), "ghostscript"
    fail(proc, "Repair")


def flatten(src: Path, mode: str = "all") -> bytes:
    doc = _open_mupdf(src)
    doc.bake(annots=(mode == "all"), widgets=True)
    return doc.tobytes(garbage=3, deflate=True)


def pdfa(src: Path, wd: Workdir, part: str = "2", do_ocr: bool = False) -> bytes:
    out = wd.file("pdfa.pdf")
    cmd = ["ocrmypdf", "--output-type", f"pdfa-{part}", "--skip-text", "--optimize", "0", "--jobs", OCR_THREADS]
    if not do_ocr:
        cmd += ["--tesseract-timeout", "0"]
    cmd += [str(src), str(out)]
    with heavy():
        proc = run(cmd, timeout=1800)
    if proc.returncode not in (0, 10) or not out.exists():
        if proc.returncode == 8:
            raise HTTPException(422, "This PDF is password protected. Unlock it first ♡")
        fail(proc, "PDF/A conversion")
    return out.read_bytes()


# --------------------------------------------------------------------------- checks

def verify_signatures(src: Path) -> dict:
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.validation import validate_pdf_signature
    from pyhanko_certvalidator import ValidationContext

    results = []
    with src.open("rb") as fh:
        try:
            reader = PdfFileReader(fh, strict=False)
        except Exception as err:
            raise HTTPException(422, f"This PDF could not be read: {err}") from err
        for sig in reader.embedded_signatures:
            entry = {"field": sig.field_name}
            try:
                status = validate_pdf_signature(sig, ValidationContext(allow_fetching=False))
                cert = status.signing_cert
                entry.update({
                    "intact": bool(status.intact),
                    "valid": bool(status.valid),
                    "trusted": bool(status.trusted),
                    "signer": cert.subject.human_friendly if cert else None,
                    "issuer": cert.issuer.human_friendly if cert else None,
                    "cert_valid_from": str(cert["tbs_certificate"]["validity"]["not_before"].native) if cert else None,
                    "cert_valid_to": str(cert["tbs_certificate"]["validity"]["not_after"].native) if cert else None,
                    "signed_at": str(status.signer_reported_dt) if status.signer_reported_dt else None,
                    "timestamp": str(status.timestamp_validity.timestamp) if getattr(status, "timestamp_validity", None) else None,
                    "coverage": status.coverage.name if status.coverage else None,
                    "modification": status.modification_level.name if status.modification_level else None,
                    "md_algorithm": status.md_algorithm,
                    "summary": status.summary(),
                })
            except Exception as err:
                entry.update({"error": str(err), "intact": False, "valid": False, "trusted": False})
            results.append(entry)
    return {"count": len(results), "signatures": results,
            "note": "“Trusted” needs the signer's root certificate in a trust list; integrity is checked independently."}


# --------------------------------------------------------------------------- security

def protect(src: Path, user_pw: str, owner_pw: str, allow: dict) -> bytes:
    if not user_pw and not owner_pw:
        raise HTTPException(400, "Please enter a password.")
    pdf = _open_pike(src)
    perms = pikepdf.Permissions(
        print_lowres=allow.get("print", True),
        print_highres=allow.get("print", True),
        extract=allow.get("copy", True),
        accessibility=True,
        modify_other=allow.get("modify", True),
        modify_assembly=allow.get("modify", True),
        modify_annotation=allow.get("annotate", True),
        modify_form=allow.get("forms", True),
    )
    buf = io.BytesIO()
    pdf.save(buf, encryption=pikepdf.Encryption(user=user_pw, owner=owner_pw or user_pw, R=6, allow=perms))
    return buf.getvalue()


def unlock(src: Path, password: str) -> bytes:
    pdf = _open_pike(src, password)
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


def remove_metadata(src: Path) -> bytes:
    pdf = _open_pike(src)
    with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
        for key in list(meta.keys()):
            del meta[key]
    if "/Metadata" in pdf.Root:
        del pdf.Root.Metadata
    for key in ("/PieceInfo", "/SpiderInfo"):
        if key in pdf.Root:
            del pdf.Root[key]
    for page in pdf.pages:
        for key in ("/Metadata", "/PieceInfo", "/Thumb"):
            if key in page.obj:
                del page.obj[key]
    if "/Info" in pdf.trailer:
        del pdf.trailer.Info
    buf = io.BytesIO()
    pdf.save(buf, fix_metadata_version=False, deterministic_id=True)
    return buf.getvalue()


def redact(src: Path, areas: list, terms: list[str], images: str = "pixels", scrub: bool = True,
           color: tuple = (0, 0, 0)) -> tuple[bytes, int]:
    """areas: [{page, rects: [[x1, y1, x2, y2] in PDF user space]}]"""
    doc = _open_mupdf(src)
    count = 0
    by_page = {}
    for a in areas or []:
        by_page.setdefault(int(a["page"]), []).extend(a.get("rects", []))
    terms = [t for t in (terms or []) if t and t.strip()]
    for page in doc:
        tm = page.transformation_matrix
        for r in by_page.get(page.number, []):
            rect = pymupdf.Rect(r[0], r[1], r[2], r[3]) * tm
            rect.normalize()
            page.add_redact_annot(rect, fill=color)
            count += 1
        for term in terms:
            for rect in page.search_for(term.strip()):
                page.add_redact_annot(rect, fill=color)
                count += 1
        img_mode = {"pixels": pymupdf.PDF_REDACT_IMAGE_PIXELS, "remove": pymupdf.PDF_REDACT_IMAGE_REMOVE,
                    "none": pymupdf.PDF_REDACT_IMAGE_NONE}.get(images, pymupdf.PDF_REDACT_IMAGE_PIXELS)
        page.apply_redactions(images=img_mode)
    if scrub:
        doc.scrub(attached_files=False, clean_pages=False, embedded_files=False, hidden_text=True,
                  javascript=True, metadata=True, redactions=False, redact_images=0, remove_links=False,
                  reset_fields=False, reset_responses=True, thumbnails=True, xml_metadata=True)
    return doc.tobytes(garbage=4, deflate=True, clean=True), count


# --------------------------------------------------------------------------- organize

def get_bookmarks(src: Path) -> dict:
    doc = _open_mupdf(src)
    toc = [{"level": lvl, "title": title, "page": page} for lvl, title, page, *_ in doc.get_toc(simple=False)]
    return {"pages": doc.page_count, "bookmarks": toc}


def set_bookmarks(src: Path, items: list) -> bytes:
    doc = _open_mupdf(src)
    toc = []
    prev = 0
    for it in items:
        lvl = max(1, min(int(it.get("level", 1)), prev + 1))
        page = max(1, min(int(it.get("page", 1)), doc.page_count))
        toc.append([lvl, str(it.get("title", "")).strip() or f"Page {page}", page])
        prev = lvl
    try:
        doc.set_toc(toc)
    except ValueError as err:
        raise HTTPException(422, f"Bookmark structure is invalid: {err}") from err
    return doc.tobytes(garbage=1, deflate=True)


def extract_images(src: Path, min_size: int = 32, fmt: str = "original") -> tuple[bytes, int]:
    doc = _open_mupdf(src)
    seen = set()
    buf = io.BytesIO()
    name = stem(src.name)
    count = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for page in doc:
            for img in page.get_images(full=True):
                xref, smask = img[0], img[1]
                if xref in seen:
                    continue
                seen.add(xref)
                try:
                    info = doc.extract_image(xref)
                except Exception:
                    continue
                if not info or info["width"] < min_size or info["height"] < min_size:
                    continue
                data, ext = info["image"], info["ext"]
                needs_png = smask or ext not in ("jpeg", "jpg", "png") or fmt == "png"
                if needs_png:
                    try:
                        pix = pymupdf.Pixmap(doc, xref)
                        if smask:
                            pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(doc, smask))
                        if pix.n - pix.alpha >= 4:
                            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                        data, ext = pix.tobytes("png"), "png"
                    except Exception:
                        pass
                count += 1
                z.writestr(f"{name}-page{page.number + 1}-{count}.{'jpg' if ext == 'jpeg' else ext}", data)
    if not count:
        raise HTTPException(422, "No images found in this PDF.")
    return buf.getvalue(), count


def text_blocks(src: Path) -> dict:
    """Paragraphs, tables and pictures with their positions (PDF user space) for “Copy from PDF”."""
    doc = _open_mupdf(src)
    pages = []
    for page in doc:
        itm = ~page.transformation_matrix
        out = []

        def pdf_rect(r):
            rr = pymupdf.Rect(r) * itm
            rr.normalize()
            return [round(rr.x0, 2), round(rr.y0, 2), round(rr.x1, 2), round(rr.y1, 2)]

        table_rects = []
        try:
            for t in page.find_tables().tables:
                rows = t.extract()
                if not rows or len(rows) < 2:
                    continue
                table_rects.append(pymupdf.Rect(t.bbox))
                out.append({"type": "table", "rect": pdf_rect(t.bbox), "rows": [[c or "" for c in r] for r in rows]})
        except Exception:
            pass
        info = page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)
        for b in info["blocks"]:
            if b["type"] != 0:
                continue
            r = pymupdf.Rect(b["bbox"])
            if any(tr.contains(r) or tr.intersect(r).get_area() > 0.6 * r.get_area() for tr in table_rects):
                continue
            text = "\n".join("".join(s["text"] for s in ln["spans"]) for ln in b["lines"]).strip()
            if text:
                out.append({"type": "text", "rect": pdf_rect(r), "text": text})
        for i, img in enumerate(page.get_image_info(xrefs=True)):
            r = pymupdf.Rect(img["bbox"]) & page.rect
            if r.width < 12 or r.height < 12:
                continue
            out.append({"type": "image", "rect": pdf_rect(r), "xref": img.get("xref", 0), "index": i})
        pages.append(out)
    return {"pages": pages}

