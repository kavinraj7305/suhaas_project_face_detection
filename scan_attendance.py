import argparse
import json
import math
import pickle
from pathlib import Path

import cv2
import numpy as np
from deepface import DeepFace


EMBEDDINGS_PATH = Path("embeddings.pkl")
MODEL_NAME_FALLBACK = "Facenet512"


def cosine_distance(v1: np.ndarray, v2: np.ndarray) -> float:
    denom = np.linalg.norm(v1) * np.linalg.norm(v2)
    if denom == 0:
        return 1.0
    return 1.0 - float(np.dot(v1, v2) / denom)


def load_known_embeddings() -> tuple[str, dict[str, list[np.ndarray]]]:
    if not EMBEDDINGS_PATH.exists():
        raise FileNotFoundError("embeddings.pkl not found. Run build_embeddings.py first.")
    with EMBEDDINGS_PATH.open("rb") as f:
        data = pickle.load(f)
    model_name = data.get("model_name", MODEL_NAME_FALLBACK)
    raw = data["embeddings"]
    known = {
        name.lower(): [np.array(v, dtype=np.float32) for v in vectors]
        for name, vectors in raw.items()
    }
    return model_name, known


def best_match(
    query_embedding: np.ndarray,
    known: dict[str, list[np.ndarray]],
    allowed: set[str],
    threshold: float,
) -> str:
    best_name = "unknown"
    best_distance = math.inf
    for person, vectors in known.items():
        if allowed and person not in allowed:
            continue
        for vector in vectors:
            distance = cosine_distance(query_embedding, vector)
            if distance < best_distance:
                best_distance = distance
                best_name = person
    if best_distance > threshold:
        return "unknown"
    return best_name


def detect_faces(gray_image: np.ndarray, frontal_cascade: cv2.CascadeClassifier) -> list[tuple[int, int, int, int]]:
    faces = frontal_cascade.detectMultiScale(gray_image, scaleFactor=1.2, minNeighbors=5, minSize=(40, 40))
    return [(int(x), int(y), int(w), int(h)) for (x, y, w, h) in faces]


def main() -> None:
    parser = argparse.ArgumentParser(description="Scan attendance from captured frame files")
    parser.add_argument("--frames-dir", required=True, help="Directory containing jpg/png frames")
    parser.add_argument("--allowed-rolls", default="", help="Comma-separated roll numbers")
    parser.add_argument("--threshold", type=float, default=0.45, help="Cosine distance threshold")
    args = parser.parse_args()

    model_name, known_embeddings = load_known_embeddings()
    allowed_rolls = {r.strip().lower() for r in args.allowed_rolls.split(",") if r.strip()}
    frame_dir = Path(args.frames_dir)
    if not frame_dir.exists():
        raise FileNotFoundError("frames directory not found")

    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    frontal_cascade = cv2.CascadeClassifier(cascade_path)
    present: set[str] = set()

    image_files = sorted([p for p in frame_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"}])
    for image_path in image_files:
        frame = cv2.imread(str(image_path))
        if frame is None:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = detect_faces(gray, frontal_cascade)
        for (x, y, w, h) in faces:
            face_crop = frame[y : y + h, x : x + w]
            if face_crop.size == 0:
                continue
            try:
                rep = DeepFace.represent(
                    img_path=face_crop[:, :, ::-1],
                    model_name=model_name,
                    detector_backend="skip",
                    enforce_detection=False,
                )
                embedding = np.array(rep[0]["embedding"], dtype=np.float32)
                name = best_match(embedding, known_embeddings, allowed_rolls, args.threshold)
                if name != "unknown":
                    present.add(name)
            except Exception:
                continue

    print(json.dumps({"present_rolls": sorted(list(present))}))


if __name__ == "__main__":
    main()
