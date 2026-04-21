import base64
import json
import os
import uuid
from pathlib import Path

import cv2
import numpy as np
from deepface import DeepFace
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import psycopg
from psycopg.rows import dict_row
from qdrant_client import QdrantClient
from qdrant_client.http import models

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

PROJECT_ROOT = Path(os.getenv("PROJECT_ROOT", "..")).resolve()
API_KEY = os.getenv("PYTHON_SERVICE_API_KEY", "").strip()
ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",")]
QDRANT_URL = os.getenv("QDRANT_URL", "").strip()
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "").strip()
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "face_embeddings").strip()
FACE_THRESHOLD = float(os.getenv("FACE_THRESHOLD", "0.45"))
MODEL_NAME = "Facenet512"
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

app = FastAPI(title="Attendance Python Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ImageBatch(BaseModel):
    images: list[str] = Field(default_factory=list)


class StudentImageBatch(ImageBatch):
    student_name: str = ""
    teacher_id: str = ""
    rebuild_embeddings: bool = True


class ScanRequest(ImageBatch):
    allowed_rolls: list[str] = Field(default_factory=list)
    threshold: float = 0.45


class AttendanceFullReportRequest(ImageBatch):
    teacher_id: int
    day: str
    section: str = ""
    department: str = ""
    passing_out_year: int = 0
    scan_seconds: int = 10
    threshold: float = 0.45


class AttendanceFullReportGetRequest(BaseModel):
    teacher_id: int
    day: str
    section: str = ""
    department: str = ""
    passing_out_year: int = 0


def require_api_key(x_api_key: str | None) -> None:
    if not API_KEY:
        return
    if not x_api_key or x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


def db_conn():
    if not DATABASE_URL:
        raise HTTPException(status_code=500, detail="DATABASE_URL is not configured")
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def qdrant_client() -> QdrantClient:
    if not QDRANT_URL:
        raise HTTPException(status_code=500, detail="QDRANT_URL is not configured")
    return QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY or None)


def decode_images(images: list[str]) -> list[np.ndarray]:
    decoded: list[np.ndarray] = []
    for data_url in images:
        if "," not in data_url:
            continue
        base64_data = data_url.split(",", 1)[1]
        try:
            image_bytes = base64.b64decode(base64_data)
            array = np.frombuffer(image_bytes, dtype=np.uint8)
            frame = cv2.imdecode(array, cv2.IMREAD_COLOR)
            if frame is not None:
                decoded.append(frame)
        except Exception:
            continue
    return decoded


def embedding_from_frame(frame_bgr: np.ndarray) -> np.ndarray | None:
    try:
        rep = DeepFace.represent(
            img_path=frame_bgr[:, :, ::-1],  # BGR -> RGB
            model_name=MODEL_NAME,
            detector_backend="opencv",
            enforce_detection=False,
        )
        return np.array(rep[0]["embedding"], dtype=np.float32)
    except Exception:
        return None


def ensure_collection(client: QdrantClient, vector_size: int) -> None:
    exists = client.collection_exists(collection_name=QDRANT_COLLECTION)
    if not exists:
        client.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=models.VectorParams(size=vector_size, distance=models.Distance.COSINE),
        )

    # Needed for filtering by roll_number in attendance scans.
    try:
        client.create_payload_index(
            collection_name=QDRANT_COLLECTION,
            field_name="roll_number",
            field_schema=models.PayloadSchemaType.KEYWORD,
        )
    except Exception:
        # Index may already exist or may not be supported in some older setups.
        pass


def qdrant_search_top1(
    client: QdrantClient,
    vector: list[float],
    search_filter: models.Filter | None = None,
):
    # Compatibility across qdrant-client versions:
    # - older versions expose `search`
    # - newer versions expose `query_points`
    try:
        if hasattr(client, "search"):
            return client.search(
                collection_name=QDRANT_COLLECTION,
                query_vector=vector,
                limit=1,
                query_filter=search_filter,
                with_payload=True,
            )

        result = client.query_points(
            collection_name=QDRANT_COLLECTION,
            query=vector,
            limit=1,
            query_filter=search_filter,
            with_payload=True,
        )
        if hasattr(result, "points"):
            return result.points
        return result or []
    except Exception:
        # Some Qdrant setups require payload index for filtered search.
        # Fallback to unfiltered nearest-neighbor; caller enforces allowed roll checks.
        if search_filter is None:
            raise
        if hasattr(client, "search"):
            return client.search(
                collection_name=QDRANT_COLLECTION,
                query_vector=vector,
                limit=1,
                with_payload=True,
            )
        result = client.query_points(
            collection_name=QDRANT_COLLECTION,
            query=vector,
            limit=1,
            with_payload=True,
        )
        if hasattr(result, "points"):
            return result.points
        return result or []


def build_attendance_rows(
    teacher_id: int,
    day: str,
    section: str,
    department: str,
    passing_out_year: int,
    present_rolls: set[str] | None = None,
    should_upsert: bool = False,
) -> dict:
    section = section.strip()
    department = department.strip()
    year = int(passing_out_year or 0)
    present_rolls = present_rolls or set()

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id AS student_id, s.roll_number
                FROM students s
                WHERE s.teacher_id = %s
                  AND (%s = '' OR LOWER(s.section) = LOWER(%s))
                  AND (%s = '' OR LOWER(s.department) = LOWER(%s))
                  AND (%s = 0 OR s.passing_out_year = %s)
                ORDER BY s.roll_number ASC
                """,
                (teacher_id, section, section, department, department, year, year),
            )
            students = cur.fetchall()

            if not students:
                return {
                    "rows": [],
                    "summary": {"present": 0, "absent": 0, "od": 0},
                    "student_count": 0,
                }

            cur.execute(
                """
                SELECT s.roll_number
                FROM od_requests o
                JOIN students s ON s.id = o.student_id
                WHERE s.teacher_id = %s
                  AND o.day = %s
                  AND (%s = '' OR LOWER(s.section) = LOWER(%s))
                  AND (%s = '' OR LOWER(s.department) = LOWER(%s))
                  AND (%s = 0 OR s.passing_out_year = %s)
                  AND o.decision = 'approved'
                """,
                (teacher_id, day, section, section, department, department, year, year),
            )
            od_rolls = {str(r["roll_number"]).lower() for r in cur.fetchall()}

            rows: list[dict] = []
            for student in students:
                roll = str(student["roll_number"]).lower()
                status = "od" if roll in od_rolls else "present" if roll in present_rolls else "absent"
                rows.append({"rollNumber": str(student["roll_number"]), "status": status})

                if should_upsert:
                    cur.execute(
                        """
                        INSERT INTO attendance (student_id, day, status)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (student_id, day)
                        DO UPDATE SET status = EXCLUDED.status
                        """,
                        (student["student_id"], day, status),
                    )

            summary = {
                "present": sum(1 for r in rows if r["status"] == "present"),
                "absent": sum(1 for r in rows if r["status"] == "absent"),
                "od": sum(1 for r in rows if r["status"] == "od"),
            }

            return {"rows": rows, "summary": summary, "student_count": len(students)}


@app.get("/health")
def health() -> dict:
    print("[API HIT] GET /health")
    return {
        "ok": True,
        "project_root": str(PROJECT_ROOT),
        "qdrant_collection": QDRANT_COLLECTION,
        "qdrant_configured": bool(QDRANT_URL),
        "database_configured": bool(DATABASE_URL),
    }


@app.post("/embeddings/rebuild")
def rebuild_embeddings(x_api_key: str | None = Header(default=None)) -> dict:
    require_api_key(x_api_key)
    print("[API HIT] POST /embeddings/rebuild")
    return {"ok": True, "message": "Vector mode enabled. Rebuild endpoint is no-op now."}


@app.post("/students/{roll_number}/images")
def upload_student_images(
    roll_number: str,
    payload: StudentImageBatch,
    x_api_key: str | None = Header(default=None),
) -> dict:
    require_api_key(x_api_key)
    print(
        f"[API HIT] POST /students/{roll_number}/images "
        f"| teacher_id={payload.teacher_id} | student_name={payload.student_name} | images={len(payload.images)}"
    )
    if not payload.images:
        raise HTTPException(status_code=400, detail="No images provided")

    frames = decode_images(payload.images)
    if not frames:
        raise HTTPException(status_code=400, detail="No valid images decoded")

    vectors: list[np.ndarray] = []
    for frame in frames:
        emb = embedding_from_frame(frame)
        if emb is not None:
            vectors.append(emb)
    if not vectors:
        raise HTTPException(status_code=400, detail="Could not create any embeddings from images")

    avg_embedding = np.mean(np.stack(vectors), axis=0).astype(np.float32)

    client = qdrant_client()
    ensure_collection(client, len(avg_embedding))

    point_id = str(uuid.uuid4())
    payload_obj = {
        "roll_number": roll_number.lower(),
        "student_name": payload.student_name.strip(),
        "teacher_id": str(payload.teacher_id).strip(),
        "image_count": len(frames),
        "embedding_count": len(vectors),
        "model_name": MODEL_NAME,
    }
    client.upsert(
        collection_name=QDRANT_COLLECTION,
        points=[
            models.PointStruct(
                id=point_id,
                vector=avg_embedding.tolist(),
                payload=payload_obj,
            )
        ],
    )
    print(
        f"[API OK ] /students/{roll_number}/images "
        f"| saved_images={len(frames)} | embedding_count={len(vectors)} | point_id={point_id}"
    )

    return {"ok": True, "saved_images": len(frames), "embedding_count": len(vectors), "point_id": point_id}


@app.post("/attendance/scan")
def scan_attendance(payload: ScanRequest, x_api_key: str | None = Header(default=None)) -> dict:
    require_api_key(x_api_key)
    print(
        f"[API HIT] POST /attendance/scan "
        f"| images={len(payload.images)} | allowed_rolls={len(payload.allowed_rolls)} | threshold={payload.threshold}"
    )
    if not payload.images:
        raise HTTPException(status_code=400, detail="No images provided")

    frames = decode_images(payload.images)
    if not frames:
        raise HTTPException(status_code=400, detail="No valid images decoded")

    client = qdrant_client()
    threshold = payload.threshold or FACE_THRESHOLD
    allowed = {roll.lower() for roll in payload.allowed_rolls}
    present_rolls: set[str] = set()

    for frame in frames:
        emb = embedding_from_frame(frame)
        if emb is None:
            continue
        search_filter = None
        if allowed:
            search_filter = models.Filter(
                must=[
                    models.FieldCondition(
                        key="roll_number",
                        match=models.MatchAny(any=list(allowed)),
                    )
                ]
            )
        hits = qdrant_search_top1(client, emb.tolist(), search_filter)
        if not hits:
            continue
        top = hits[0]
        if top.score < 1.0 - threshold:
            continue
        roll = str((top.payload or {}).get("roll_number", "")).lower()
        if allowed and roll not in allowed:
            continue
        if roll:
            present_rolls.add(roll)

    print(
        f"[API OK ] /attendance/scan | decoded_frames={len(frames)} | present_rolls={sorted(list(present_rolls))}"
    )
    return {"ok": True, "saved": len(frames), "present_rolls": sorted(list(present_rolls))}


@app.post("/attendance/full-report")
def attendance_full_report(
    payload: AttendanceFullReportRequest, x_api_key: str | None = Header(default=None)
) -> dict:
    require_api_key(x_api_key)
    print(
        f"[API HIT] POST /attendance/full-report | teacher_id={payload.teacher_id} | day={payload.day} "
        f"| sec={payload.section} | dept={payload.department} | year={payload.passing_out_year} "
        f"| images={len(payload.images)} | seconds={payload.scan_seconds}"
    )

    if not payload.images:
        raise HTTPException(status_code=400, detail="No images provided")

    frames = decode_images(payload.images)
    if not frames:
        raise HTTPException(status_code=400, detail="No valid images decoded")

    client = qdrant_client()
    threshold = payload.threshold or FACE_THRESHOLD
    present_rolls: set[str] = set()

    report_preview = build_attendance_rows(
        teacher_id=payload.teacher_id,
        day=payload.day,
        section=payload.section,
        department=payload.department,
        passing_out_year=payload.passing_out_year,
    )
    allowed = {str(r["rollNumber"]).lower() for r in report_preview["rows"]}

    for frame in frames:
        emb = embedding_from_frame(frame)
        if emb is None:
            continue
        search_filter = None
        if allowed:
            search_filter = models.Filter(
                must=[
                    models.FieldCondition(
                        key="roll_number",
                        match=models.MatchAny(any=list(allowed)),
                    )
                ]
            )
        hits = qdrant_search_top1(client, emb.tolist(), search_filter)
        if not hits:
            continue
        top = hits[0]
        if top.score < 1.0 - threshold:
            continue
        roll = str((top.payload or {}).get("roll_number", "")).lower()
        if allowed and roll not in allowed:
            continue
        if roll:
            present_rolls.add(roll)

    final_report = build_attendance_rows(
        teacher_id=payload.teacher_id,
        day=payload.day,
        section=payload.section,
        department=payload.department,
        passing_out_year=payload.passing_out_year,
        present_rolls=present_rolls,
        should_upsert=True,
    )

    report_json = {
        "scanSeconds": payload.scan_seconds,
        "section": payload.section or None,
        "department": payload.department or None,
        "passingOutYear": payload.passing_out_year or None,
        "summary": final_report["summary"],
        "rows": final_report["rows"],
    }
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO attendance_scans (teacher_id, day, report_json)
                VALUES (%s, %s, %s::jsonb)
                """,
                (payload.teacher_id, payload.day, json.dumps(report_json)),
            )
            conn.commit()

    print(
        f"[API OK ] /attendance/full-report | present={final_report['summary']['present']} "
        f"| od={final_report['summary']['od']} | absent={final_report['summary']['absent']}"
    )
    return {
        "ok": True,
        "day": payload.day,
        "scanSeconds": payload.scan_seconds,
        "section": payload.section or None,
        "department": payload.department or None,
        "passingOutYear": payload.passing_out_year or None,
        "summary": final_report["summary"],
        "report": final_report["rows"],
    }


@app.post("/attendance/full-report/get")
def attendance_full_report_get(
    payload: AttendanceFullReportGetRequest, x_api_key: str | None = Header(default=None)
) -> dict:
    require_api_key(x_api_key)
    print(
        f"[API HIT] POST /attendance/full-report/get | teacher_id={payload.teacher_id} | day={payload.day} "
        f"| sec={payload.section} | dept={payload.department} | year={payload.passing_out_year}"
    )

    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, day, report_json, created_at
                FROM attendance_scans
                WHERE teacher_id = %s
                  AND day = %s
                  AND (%s = '' OR LOWER(COALESCE(report_json->>'section','')) = LOWER(%s))
                  AND (%s = '' OR LOWER(COALESCE(report_json->>'department','')) = LOWER(%s))
                  AND (%s = 0 OR COALESCE((report_json->>'passingOutYear')::int, 0) = %s)
                ORDER BY created_at DESC
                LIMIT 10
                """,
                (
                    payload.teacher_id,
                    payload.day,
                    payload.section,
                    payload.section,
                    payload.department,
                    payload.department,
                    payload.passing_out_year,
                    payload.passing_out_year,
                ),
            )
            scans = cur.fetchall()

    report = build_attendance_rows(
        teacher_id=payload.teacher_id,
        day=payload.day,
        section=payload.section,
        department=payload.department,
        passing_out_year=payload.passing_out_year,
    )

    return {
        "ok": True,
        "scans": scans,
        "report": {
            "day": payload.day,
            "section": payload.section or None,
            "department": payload.department or None,
            "passingOutYear": payload.passing_out_year or None,
            "summary": report["summary"],
            "rows": report["rows"],
        },
    }
