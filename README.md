# Face Attendance Prototype (Laptop)

Single-device pipeline:

`Webcam -> Face Detection -> Face Recognition -> Attendance Tracking`

## 1) Setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 2) Register person images

Capture 5-10 images per person:

```bash
python register_faces.py --name kavin --samples 10
python register_faces.py --name arun --samples 10
```

This creates:

```text
dataset/
  kavin/
  arun/
```

## 3) Build embeddings

```bash
python build_embeddings.py
```

This creates `embeddings.pkl`.

## 4) Run live attendance

```bash
python main.py
```

Press `q` to stop.

After exit, script writes `attendance_report.csv` with:
- person name
- seen count
- total checks
- attendance percentage
- timestamps

## Notes

- Detection uses Haar cascade (fast, beginner friendly).
- Recognition uses DeepFace embeddings + cosine distance.
- Frames are resized, and recognition runs every few seconds for performance.
- `MATCH_THRESHOLD` in `main.py` controls strictness (lower = stricter).
