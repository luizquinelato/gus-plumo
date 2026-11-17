FROM python:3.11-slim-bookworm

WORKDIR /app/services/backend

# Dependências de sistema para psycopg2, PDF e OCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libgomp1 \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY services/backend/requirements/install.txt requirements/install.txt
RUN pip install --no-cache-dir -r requirements/install.txt

COPY services/backend/ /app/services/backend/

RUN mkdir -p uploads/avatars

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

COPY deploy/backend-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]