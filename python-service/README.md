# Python Service (FastAPI)

This service exposes your face-processing features as HTTP APIs so the Next.js frontend can be deployed separately.
It stores face embeddings in Qdrant (vector DB) with proper student metadata.

## Endpoints

- `GET /health`
- `POST /embeddings/rebuild`
- `POST /students/{roll_number}/images`
- `POST /attendance/scan`

All `POST` endpoints support API-key auth via `x-api-key` header when `PYTHON_SERVICE_API_KEY` is set.

## Setup

```bash
cd python-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Create `.env` from `.env.example`:

```env
PYTHON_SERVICE_API_KEY=your-secret
PROJECT_ROOT=../
ALLOWED_ORIGINS=*
QDRANT_URL=https://your-cluster-url
QDRANT_API_KEY=your-qdrant-api-key
QDRANT_COLLECTION=face_embeddings
FACE_THRESHOLD=0.45
```

## Run locally

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Health check:

```bash
curl http://localhost:8000/health
```

## Sample calls

### Upload student images and store embedding in Qdrant

```bash
curl -X POST http://localhost:8000/students/100/images ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: your-secret" ^
  -d "{\"images\":[\"data:image/jpeg;base64,...\"],\"student_name\":\"Kavin\",\"teacher_id\":\"1\"}"
```

### Scan attendance from frame batch

```bash
curl -X POST http://localhost:8000/attendance/scan ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: your-secret" ^
  -d "{\"images\":[\"data:image/jpeg;base64,...\"],\"allowed_rolls\":[\"100\",\"101\"],\"threshold\":0.45}"
```

## Deploy free/easy

- **Render**: create a new Web Service from this folder
  - Build: `pip install -r requirements.txt`
  - Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Railway**: same start command, set env vars in dashboard
