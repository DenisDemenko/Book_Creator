# GrabFusion: застосунок викладача (FastAPI + PWA). Збірка з кореня services/grabfusion.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    GRABFUSION_HOST=0.0.0.0

WORKDIR /app
COPY pyproject.toml ./
COPY grabfusion ./grabfusion
RUN pip install .

# Сесії (токени Studio) лежать у SQLite: змонтуйте том і вкажіть GRABFUSION_SESSION_DB=/data/sessions.sqlite3
RUN mkdir -p /data
EXPOSE 8000
CMD ["grabfusion"]
