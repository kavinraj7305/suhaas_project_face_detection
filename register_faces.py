import argparse
from pathlib import Path

import cv2


def detect_faces(
    gray_image,
    frontal_cascade: cv2.CascadeClassifier,
    profile_cascade: cv2.CascadeClassifier,
) -> list[tuple[int, int, int, int]]:
    faces: list[tuple[int, int, int, int]] = []

    frontal = frontal_cascade.detectMultiScale(
        gray_image, scaleFactor=1.2, minNeighbors=5, minSize=(40, 40)
    )
    for x, y, w, h in frontal:
        faces.append((int(x), int(y), int(w), int(h)))

    profile = profile_cascade.detectMultiScale(
        gray_image, scaleFactor=1.2, minNeighbors=4, minSize=(40, 40)
    )
    for x, y, w, h in profile:
        faces.append((int(x), int(y), int(w), int(h)))

    flipped = cv2.flip(gray_image, 1)
    flipped_profile = profile_cascade.detectMultiScale(
        flipped, scaleFactor=1.2, minNeighbors=4, minSize=(40, 40)
    )
    width = gray_image.shape[1]
    for x, y, w, h in flipped_profile:
        rx = width - (x + w)
        faces.append((int(rx), int(y), int(w), int(h)))

    return faces


def build_stages(total_samples: int) -> list[tuple[str, int]]:
    prompts = ["look front", "look left", "look right", "move back"]
    base = total_samples // len(prompts)
    remainder = total_samples % len(prompts)

    stages: list[tuple[str, int]] = []
    for idx, prompt in enumerate(prompts):
        count = base + (1 if idx < remainder else 0)
        if count > 0:
            stages.append((prompt, count))
    return stages


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

    frontal_cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    profile_cascade_path = cv2.data.haarcascades + "haarcascade_profileface.xml"
    frontal_cascade = cv2.CascadeClassifier(frontal_cascade_path)
    profile_cascade = cv2.CascadeClassifier(profile_cascade_path)

    stages = build_stages(args.samples)
    if not stages:
        raise RuntimeError("samples must be greater than 0.")

    saved = 0
    frame_id = 0
    stage_index = 0
    stage_saved = 0
    print("Press 'q' to quit early.")
    print("Follow the prompts shown on screen for better dataset quality.")

    while saved < args.samples:
        ok, frame = cap.read()
        if not ok:
            print("Failed to read frame, retrying...")
            continue

        frame_id += 1
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = detect_faces(gray, frontal_cascade, profile_cascade)

        stage_prompt, stage_target = stages[stage_index]

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

                out_path = person_dir / f"img_{saved + 1:03d}.jpg"
                cv2.imwrite(str(out_path), face_crop)
                saved += 1
                stage_saved += 1
                print(
                    f"Saved {out_path} ({saved}/{args.samples}) "
                    f"[{stage_prompt}: {stage_saved}/{stage_target}]"
                )

                if stage_saved >= stage_target and stage_index < len(stages) - 1:
                    stage_index += 1
                    stage_saved = 0

        cv2.putText(
            frame,
            f"{args.name}: {saved}/{args.samples}",
            (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (60, 220, 60),
            2,
        )
        cv2.putText(
            frame,
            f"Prompt: {stage_prompt} ({stage_saved}/{stage_target})",
            (10, 70),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (80, 200, 255),
            2,
        )
        cv2.putText(
            frame,
            "Tip: hold still for 1 sec when prompt changes",
            (10, 105),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 255),
            1,
        )
        cv2.imshow("Register Faces", frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()
    print("Done. Now run: python build_embeddings.py")


if __name__ == "__main__":
    main()
