# Next.js Attendance Portal (Neon SQL)

This is the web portal for:
- teacher login
- student login
- teacher creates students with auto-generated password
- attendance table by date (present/absent/od)
- student OD submission (reason + image)
- teacher approve/reject OD
- teacher 10-second attendance scan with live report

## 1) Setup

```bash
cd web
npm install
```

Create `.env.local` from `.env.example`:

```env
DATABASE_URL=postgresql://...
JWT_SECRET=...
PYTHON_CMD=python
CAMERA_INDEX=0
CAPTURE_TIMEOUT_SEC=120
```

## 2) Create SQL tables in Neon

Open Neon SQL editor and run `lib/schema.sql`.

## 3) Create first teacher account

Start app:

```bash
npm run dev
```

Open `/` and click **Register Teacher**, then create teacher with:
- name: `Teacher1`
- password: `Teacher@123`

After that, login from `/` as teacher using the same credentials.

## 4) Main flow

- Teacher adds student (name, roll, section, department, passing out year, photo samples)
- For reliable capture, use **Open Camera** in teacher dashboard (browser camera preview)
- Captured images are saved to local `dataset/<roll_number>/`
- After upload, `build_embeddings.py` runs automatically
- System generates and returns student password (hashed in DB)
- Student logs in using roll number + generated password
- Student submits OD with reason + letter image
- Teacher approves/rejects OD
- Approved OD auto-marks attendance as `od` for that day
- Teacher can click **Take Attendance** to run a 10-second browser camera scan.
- Scan marks: approved OD => `od`, detected face => `present`, remaining => `absent`.

## Notes for Python integration

- Run web app on the same machine where Python scripts exist.
- API calls execute these scripts from project root:
  - `register_faces.py`
  - `build_embeddings.py`
- If webcam fails to open, set `CAMERA_INDEX=1` (or 2) in `.env.local` and restart Next.js.
- Capture runs with timeout (`CAPTURE_TIMEOUT_SEC`) so API won't hang forever.
