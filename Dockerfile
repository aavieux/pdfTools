FROM python:3.12-slim-trixie
ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 PLAYWRIGHT_BROWSERS_PATH=/opt/playwright HOME=/tmp

# Engines used by the server-side tools: LibreOffice (Office conversions),
# Ghostscript + qpdf (compress, PDF/A, repair), Tesseract (OCR), Poppler.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw \
      ghostscript qpdf poppler-utils pngquant libcairo2 tini \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-deu tesseract-ocr-nld tesseract-ocr-fra \
      tesseract-ocr-spa tesseract-ocr-ita tesseract-ocr-bul tesseract-ocr-rus tesseract-ocr-por \
      fonts-dejavu fonts-liberation fonts-noto-core fonts-noto-color-emoji fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*
COPY server/requirements.txt /app/requirements.txt
# Only Chromium's headless shell: it's all the PDF printing needs (the full browser is ~400 MB more).
RUN pip install -r /app/requirements.txt && playwright install --with-deps --only-shell chromium && rm -rf /var/lib/apt/lists/*

# Fewer malloc pools = less memory kept around after big jobs (matters on a NAS with little RAM).
ENV PYTHONUNBUFFERED=1 MALLOC_ARENA_MAX=2
RUN useradd --system --uid 1000 --home /tmp app
COPY server/ /app/server/
COPY web/ /app/web/

USER app
WORKDIR /app
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health')" || exit 1
# One worker is plenty for a home NAS and saves ~130 MB of RAM; heavy jobs still run side by side.
# tini as process #1 cleans up after ended programs (e.g. OCR stopped because the page was closed).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "exec uvicorn server.main:app --host 0.0.0.0 --port 8080 --workers ${WORKERS:-1}"]
