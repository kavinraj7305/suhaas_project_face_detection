import argparse
from pathlib import Path

import cv2


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Capture face images for one person into dataset/<name>/"
    )
    parser.add_argument("--name", required=True, help="Person name, e.g. kavin")
    parser.add_argument(
        "--samples",
        type=int,
        default=10,
        help="Number of cropped face images to save (default: 10)",
    )
    args = parser.parse_args()

    person_dir = Path("dataset") / args.name.strip().lower()
    person_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Unable to open webcam.")

    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(cascade_path)

    saved = 0
    frame_id = 0
    print("Press 'q' to quit early.")

    while saved < args.samples:
        ok, frame = cap.read()
        if not ok:
            print("Failed to read frame, retrying...")
            continue

        frame_id += 1
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=5)

        if len(faces) > 0:
            # Pick largest detected face so background faces do not pollute training.
            x, y, w, h = max(faces, key=lambda box: box[2] * box[3])
            cv2.rectangle(frame, (x, y), (x + w, y + h), (60, 220, 60), 2)

            # Save one crop every few frames so images differ naturally.
            if frame_id % 5 == 0 and saved < args.samples:
                pad = 20
                x1 = max(0, x - pad)
                y1 = max(0, y - pad)
                x2 = min(frame.shape[1], x + w + pad)
                y2 = min(frame.shape[0], y + h + pad)
                face_crop = frame[y1:y2, x1:x2]

                out_path = person_dir / f"img_{saved + 1:02d}.jpg"
                cv2.imwrite(str(out_path), face_crop)
                saved += 1
                print(f"Saved {out_path} ({saved}/{args.samples})")

        cv2.putText(
            frame,
            f"{args.name}: {saved}/{args.samples}",
            (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (60, 220, 60),
            2,
        )
        cv2.imshow("Register Faces", frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()
    print("Done. Now run: python build_embeddings.py")


if __name__ == "__main__":
    main()
