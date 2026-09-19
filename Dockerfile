FROM node:24-alpine AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY samples/ ./samples/
COPY --from=frontend /build/dist ./frontend/dist
RUN useradd --create-home app
USER app
CMD ["sh", "-c", "uvicorn backend.main:create_app --factory --host 0.0.0.0 --port ${PORT:-8000}"]
