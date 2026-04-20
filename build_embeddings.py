import pickle
from collections import defaultdict
from pathlib import Path

from deepface import DeepFace


DATASET_DIR = Path("dataset")
OUTPUT_PATH = Path("embeddings.pkl")
MODEL_NAME = "Facenet512"


def load_embeddings() -> dict[str, list[list[float]]]:
    person_embeddings: dict[str, list[list[float]]] = defaultdict(list)

    if not DATASET_DIR.exists():
        raise FileNotFoundError("dataset/ folder not found.")

    for person_dir in sorted(DATASET_DIR.iterdir()):
        if not person_dir.is_dir():
            continue

        person_name = person_dir.name.lower()
        image_files = [
            p
            for p in person_dir.iterdir()
            if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
        ]

        for image_path in sorted(image_files):
            try:
                reps = DeepFace.represent(
                    img_path=str(image_path),
                    model_name=MODEL_NAME,
                    detector_backend="opencv",
                    enforce_detection=True,
                )
                person_embeddings[person_name].append(reps[0]["embedding"])
                print(f"OK: {image_path}")
            except Exception as exc:  # noqa: BLE001
                print(f"SKIP: {image_path} ({exc})")

    return person_embeddings


def main() -> None:
    embeddings = load_embeddings()
    if not embeddings:
        raise RuntimeError("No embeddings generated. Add better face images in dataset/.")

    with OUTPUT_PATH.open("wb") as f:
        pickle.dump(
            {
                "model_name": MODEL_NAME,
                "embeddings": dict(embeddings),
            },
            f,
        )

    print(
        f"Saved {OUTPUT_PATH} with {sum(len(v) for v in embeddings.values())} embeddings "
        f"for {len(embeddings)} people."
    )
    print("Now run: python main.py")


if __name__ == "__main__":
    main()
