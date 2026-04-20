import math
import pickle
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
from deepface import DeepFace


EMBEDDINGS_PATH = Path("embeddings.pkl")
MODEL_NAME_FALLBACK = "Facenet512"
PROCESS_INTERVAL_SEC = 2.0
MIN_LOG_GAP_SEC = 120
MATCH_THRESHOLD = 0.30
FRAME_SCALE = 0.5


def cosine_distance(v1: np.ndarray, v2: np.ndarray) -> float:
    denom = np.linalg.norm(v1) * np.linalg.norm(v2)
    if denom == 0:
        return 1.0
    return 1.0 - float(np.dot(v1, v2) / denom)


def best_match(
    query_embedding: np.ndarray, known: dict[str, list[np.ndarray]]
) -> tuple[str, float]:
    best_name = "unknown"
    best_distance = math.inf

    for person, vectors in known.items():
        for vector in vectors:
            dist = cosine_distance(query_embedding, vector)
            if dist < best_distance:
                best_distance = dist
                best_name = person

    if best_distance > MATCH_THRESHOLD:
        return "unknown", best_distance
    return best_name, best_distance


def load_known_embeddings() -> tuple[str, dict[str, list[np.ndarray]]]:
    if not EMBEDDINGS_PATH.exists():
        raise FileNotFoundError("embeddings.pkl not found. Run build_embeddings.py first.")

    with EMBEDDINGS_PATH.open("rb") as f:
        data = pickle.load(f)

    model_name = data.get("model_name", MODEL_NAME_FALLBACK)
    raw_embeddings: dict[str, list[list[float]]] = data["embeddings"]
    known = {
        person: [np.array(v, dtype=np.float32) for v in vectors]
        for person, vectors in raw_embeddings.items()
    }
    return model_name, known


def write_attendance_report(
    attendance: dict[str, list[str]], checks_per_person: dict[str, int]
) -> None:
    rows = []
    for name, check_count in checks_per_person.items():
        seen_count = len(attendance[name])
        percentage = (seen_count / check_count * 100.0) if check_count else 0.0
        rows.append(
            {
                "name": name,
                "seen_count": seen_count,
                "total_checks": check_count,
                "attendance_percent": round(percentage, 2),
                "timestamps": ", ".join(attendance[name]),
            }
        )

    out_df = pd.DataFrame(rows).sort_values(by="name")
    out_df.to_csv("attendance_report.csv", index=False)
    print("\nSaved attendance_report.csv")
    print(out_df.to_string(index=False))


def main() -> None:
    model_name, known_embeddings = load_known_embeddings()
    tracked_people = sorted(known_embeddings.keys())
    attendance: dict[str, list[str]] = defaultdict(list)
    checks_per_person: dict[str, int] = {name: 0 for name in tracked_people}
    last_logged_at: dict[str, float] = {name: 0.0 for name in tracked_people}

    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(cascade_path)
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Unable to open webcam.")

    print("Running live recognition. Press 'q' to stop.")
    last_process_at = 0.0
    latest_results: list[tuple[tuple[int, int, int, int], str, float]] = []

    while True:
        ok, frame = cap.read()
        if not ok:
            continue

        display_frame = frame.copy()
        now = time.time()

        if now - last_process_at >= PROCESS_INTERVAL_SEC:
            resized = cv2.resize(
                frame, (0, 0), fx=FRAME_SCALE, fy=FRAME_SCALE, interpolation=cv2.INTER_AREA
            )
            gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=5)

            detected_names: set[str] = set()
            latest_results = []
            for (x, y, w, h) in faces:
                # Convert face box back to original frame coordinates.
                ox = int(x / FRAME_SCALE)
                oy = int(y / FRAME_SCALE)
                ow = int(w / FRAME_SCALE)
                oh = int(h / FRAME_SCALE)

                face_crop = frame[oy : oy + oh, ox : ox + ow]
                if face_crop.size == 0:
                    continue

                try:
                    rep = DeepFace.represent(
                        img_path=face_crop[:, :, ::-1],  # BGR -> RGB
                        model_name=model_name,
                        detector_backend="skip",
                        enforce_detection=False,
                    )
                    embedding = np.array(rep[0]["embedding"], dtype=np.float32)
                    name, distance = best_match(embedding, known_embeddings)
                except Exception:  # noqa: BLE001
                    name, distance = "unknown", 1.0

                latest_results.append(((ox, oy, ow, oh), name, distance))
                if name != "unknown":
                    detected_names.add(name)

            # Every processing cycle counts as one attendance check per known person.
            for person in tracked_people:
                checks_per_person[person] += 1
                if person in detected_names and now - last_logged_at[person] >= MIN_LOG_GAP_SEC:
                    timestamp = datetime.now().strftime("%H:%M:%S")
                    attendance[person].append(timestamp)
                    last_logged_at[person] = now

            last_process_at = now

        for (x, y, w, h), name, distance in latest_results:
            color = (40, 200, 40) if name != "unknown" else (40, 40, 220)
            cv2.rectangle(display_frame, (x, y), (x + w, y + h), color, 2)
            cv2.putText(
                display_frame,
                f"{name} ({distance:.2f})",
                (x, max(20, y - 10)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                color,
                2,
            )

        cv2.putText(
            display_frame,
            "Press q to quit",
            (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (255, 255, 255),
            2,
        )
        cv2.imshow("Face Attendance Prototype", display_frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()
    write_attendance_report(attendance, checks_per_person)


if __name__ == "__main__":
    main()
