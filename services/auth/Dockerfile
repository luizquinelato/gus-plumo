FROM python:3.11-slim-bookworm

WORKDIR /app/services/auth

RUN apt-get update && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY services/auth/requirements/install.txt requirements/install.txt
RUN pip install --no-cache-dir -r requirements/install.txt python-dotenv==1.0.1

COPY services/auth/ /app/services/auth/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOST=0.0.0.0 \
    PORT=8001

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]