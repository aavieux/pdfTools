"""Small helpers shared by the API routes."""

import contextlib
import contextvars
import ctypes
import fcntl
import multiprocessing
import os
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import unicodedata
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException, UploadFile
from fastapi.responses import Response

# Heavy engines (LibreOffice, Chromium, Ghostscript, OCR) are limited so a small NAS doesn't
# run out of memory when several jobs arrive at once. The limit is shared by all server
# processes (lock files), so it holds however many workers uvicorn runs.
# Set when the browser goes away (tab closed, page left): running engines are then stopped so the
# NAS doesn't keep working on a result nobody will receive. See CancelOnDisconnect in main.py.
CANCEL: contextvars.ContextVar[threading.Event | None] = contextvars.ContextVar("cancel", default=None)


class Cancelled(HTTPException):
    def __init__(self):
        super().__init__(499, "Stopped because the page was closed.")


def check_cancel():
    ev = CANCEL.get()
    if ev is not None and ev.is_set():
        raise Cancelled()


def _ram_mb() -> int:
    """RAM this container may use: its Docker memory limit if one is set, else the NAS's RAM."""
    try:
        limit = Path("/sys/fs/cgroup/memory.max").read_text().strip()
        if limit.isdigit():
            return int(limit) // 2**20
    except OSError:
        pass
    try:
        with open("/proc/meminfo") as fh:
            for line in fh:
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) // 1024
    except OSError:
        pass
    return 4096


def free_ram_mb() -> int:
    """RAM that can be used right now: what the NAS has available, capped by the container limit."""
    free = []
    try:
        with open("/proc/meminfo") as fh:
            for line in fh:
                if line.startswith("MemAvailable:"):
                    free.append(int(line.split()[1]) // 1024)
    except OSError:
        pass
    for limit_f, usage_f in (("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"),
                             ("/sys/fs/cgroup/memory/memory.limit_in_bytes", "/sys/fs/cgroup/memory/memory.usage_in_bytes")):
        try:
            limit = Path(limit_f).read_text().strip()
            if limit.isdigit() and int(limit) < 2**60:
                free.append((int(limit) - int(Path(usage_f).read_text())) // 2**20)
            break
        except OSError:
            continue
    return max(0, min(free)) if free else 4096


RAM_MB = _ram_mb()
# Below ~3 GB: one heavy job at a time and single-threaded OCR (OCR is the hungriest engine).
LOW_RAM = RAM_MB < 3000
HEAVY_LIMIT = max(1, int(os.environ.get("HEAVY_JOBS") or (1 if LOW_RAM else 2)))
LOCK_DIR = Path(tempfile.gettempdir())
# CPU threads one OCR job may use; never more than the NAS has.
OCR_THREADS = os.environ.get("OCR_THREADS") or str(max(1, min(1 if LOW_RAM else 2, os.cpu_count() or 1)))

MIME = {
    "pdf": "application/pdf",
    "zip": "application/zip",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "odt": "application/vnd.oasis.opendocument.text",
    "ods": "application/vnd.oasis.opendocument.spreadsheet",
    "odp": "application/vnd.oasis.opendocument.presentation",
    "rtf": "application/rtf",
    "txt": "text/plain; charset=utf-8",
    "md": "text/markdown; charset=utf-8",
    "html": "text/html; charset=utf-8",
    "epub": "application/epub+zip",
    "svg": "image/svg+xml",
    "tiff": "image/tiff",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "jfif": "image/jpeg",
    "webp": "image/webp",
    "heic": "image/heic",
    "heif": "image/heif",
    "gif": "image/gif",
    "bmp": "image/bmp",
    "tif": "image/tiff",
    "xml": "application/xml",
    "json": "application/json",
}


class Workdir:
    """A temporary directory that is removed when the request is finished."""

    def __init__(self):
        self.path = Path(tempfile.mkdtemp(prefix="mpt-"))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        shutil.rmtree(self.path, ignore_errors=True)

    def file(self, name: str) -> Path:
        return self.path / name


def safe_name(name: str | None, default: str = "file") -> str:
    name = unicodedata.normalize("NFKC", name or default)
    name = os.path.basename(name.replace("\\", "/"))
    name = re.sub(r"[^\w.\- ()\[\]]+", "_", name).strip(" .")
    return name[:150] or default


def stem(name: str | None) -> str:
    return os.path.splitext(safe_name(name, "document"))[0]


def ext(name: str | None) -> str:
    return os.path.splitext(name or "")[1].lower().lstrip(".")


async def save_upload(upload: UploadFile, wd: Workdir, name: str | None = None) -> Path:
    if upload is None:
        raise HTTPException(400, "No file was uploaded.")
    target = wd.file(name or safe_name(upload.filename))
    with target.open("wb") as fh:
        while chunk := await upload.read(1024 * 1024):
            fh.write(chunk)
    if target.stat().st_size == 0:
        raise HTTPException(400, f"{upload.filename or 'The file'} is empty.")
    return target


def file_response(data: bytes | Path, filename: str, kind: str | None = None, headers: dict | None = None) -> Response:
    if isinstance(data, Path):
        data = data.read_bytes()
    kind = kind or ext(filename)
    disp = f"attachment; filename=\"{safe_name(filename).encode('ascii', 'replace').decode()}\"; filename*=UTF-8''{quote(filename)}"
    return Response(content=data, media_type=MIME.get(kind, "application/octet-stream"),
                    headers={"Content-Disposition": disp, **(headers or {})})


def _kill_group(proc: subprocess.Popen):
    try:
        os.killpg(proc.pid, signal.SIGKILL)  # the program and everything it started (soffice.bin, tesseract…)
    except (ProcessLookupError, PermissionError):
        pass
    proc.communicate()


def run(cmd: list[str], timeout: int = 300, cwd: Path | None = None, env: dict | None = None) -> subprocess.CompletedProcess:
    """Run an external program; turn failures into readable HTTP errors. It's stopped when the
    page is closed or when it takes longer than `timeout` seconds."""
    try:
        proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env={**os.environ, **(env or {})}, start_new_session=True)
    except FileNotFoundError as err:
        raise HTTPException(500, f"{cmd[0]} is not installed in the container.") from err
    deadline = time.monotonic() + timeout
    while True:
        try:
            out, err = proc.communicate(timeout=0.5)
            return subprocess.CompletedProcess(cmd, proc.returncode, out, err)
        except subprocess.TimeoutExpired:
            if time.monotonic() > deadline:
                _kill_group(proc)
                raise HTTPException(504, f"{os.path.basename(cmd[0])} took too long and was stopped.") from None
            ev = CANCEL.get()
            if ev is not None and ev.is_set():
                _kill_group(proc)
                raise Cancelled() from None


def fail(proc: subprocess.CompletedProcess, what: str):
    tail = (proc.stderr or proc.stdout or b"").decode("utf-8", "replace").strip().splitlines()[-3:]
    raise HTTPException(422, f"{what} failed: {' '.join(tail) or 'unknown error'}")


@contextlib.contextmanager
def heavy():
    """Wait for one of the HEAVY_LIMIT slots, then hold it while the engine runs."""
    while True:
        for i in range(HEAVY_LIMIT):
            fh = open(LOCK_DIR / f"mpt-heavy-{i}.lock", "w")  # noqa: SIM115 - closed below
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                fh.close()
                continue
            try:
                yield
                return
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)
                fh.close()
        check_cancel()
        time.sleep(0.2)


def _isolated_child(conn, fn, args):
    try:
        conn.send(("ok", fn(*args)))
    except HTTPException as err:  # HTTPException can't cross processes as-is
        conn.send(("http", err.status_code, err.detail))
    except BaseException as err:  # noqa: BLE001 - report anything to the server
        conn.send(("error", f"{type(err).__name__}: {err}"))
    finally:
        conn.close()


def isolated(fn, *args, timeout: int = 900):
    """Run fn(*args) in a short-lived helper process. Jobs that load big libraries (OpenCV, NumPy,
    SciPy, ONNX…) would otherwise keep that memory in the server forever; this way all of it goes
    back to the NAS the moment the job is done (about a second to start the helper). The helper is
    killed when the page is closed or after `timeout` seconds."""
    ctx = multiprocessing.get_context("spawn")
    parent, child = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_isolated_child, args=(child, fn, args), daemon=True)
    proc.start()
    child.close()
    deadline = time.monotonic() + timeout
    try:
        while not parent.poll(0.5):
            if not proc.is_alive():  # died without answering: almost always the out-of-memory killer
                raise HTTPException(507, "The NAS ran out of memory for this file. Try a smaller file, "
                                         "or close other apps on the NAS.")
            if time.monotonic() > deadline:
                raise HTTPException(504, "This took too long and was stopped.")
            check_cancel()
        result = parent.recv()
    finally:
        if proc.is_alive():
            proc.kill()
        proc.join(5)
        parent.close()
    if result[0] == "http":
        raise HTTPException(result[1], result[2])
    if result[0] == "error":
        raise HTTPException(500, f"Something went wrong: {result[1]}")
    return result[1]


def release_memory():
    """Give memory that Python freed back to the system (glibc keeps it otherwise)."""
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except (OSError, AttributeError):
        pass


_LO_TEMPLATE = LOCK_DIR / "mpt-lo-template"
_LO_TEMPLATE_LOCK = threading.Lock()


def _lo_profile(wd: Workdir) -> Path:
    """A LibreOffice profile for this job. Building one from scratch makes every conversion a few
    seconds slower on a NAS, so the first job builds a template and later jobs copy it (~1 ms)."""
    profile = wd.file("lo-profile")
    with _LO_TEMPLATE_LOCK:
        if not (_LO_TEMPLATE / "user").is_dir():
            boot = wd.file("lo-boot")
            boot.mkdir()
            (boot / "x.txt").write_text("x")
            run(["soffice", f"-env:UserInstallation=file://{_LO_TEMPLATE}", "--headless", "--norestore", "--nolockcheck",
                 "--convert-to", "pdf", "--outdir", str(boot), str(boot / "x.txt")], timeout=120)
    if (_LO_TEMPLATE / "user").is_dir():
        shutil.copytree(_LO_TEMPLATE, profile, ignore=shutil.ignore_patterns(".lock", "*.lock"))
    return profile


def libreoffice_convert(src: Path, target: str, wd: Workdir, infilter: str | None = None, timeout: int = 240) -> Path:
    """Convert with LibreOffice. Each call gets its own profile so jobs can run in parallel."""
    outdir = wd.file("lo-out")
    outdir.mkdir(exist_ok=True)
    with heavy():
        profile = _lo_profile(wd)
        cmd = ["soffice", f"-env:UserInstallation=file://{profile}", "--headless", "--norestore", "--nolockcheck"]
        if infilter:
            cmd.append(f"--infilter={infilter}")
        cmd += ["--convert-to", target, "--outdir", str(outdir), str(src)]
        proc = run(cmd, timeout=timeout)
    out_ext = target.split(":")[0]
    produced = list(outdir.glob(f"*.{out_ext}"))
    if not produced:
        fail(proc, "LibreOffice conversion")
    return produced[0]
