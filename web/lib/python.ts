import { execFile, spawn } from "child_process";
import { resolve } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function pythonCmd() {
  return process.env.PYTHON_CMD || "python";
}

function cameraIndex() {
  return process.env.CAMERA_INDEX || "0";
}

function captureTimeoutSec() {
  return Number(process.env.CAPTURE_TIMEOUT_SEC || "120");
}

function projectRoot() {
  return resolve(process.cwd(), "..");
}

export async function captureStudentPhotos(rollNumber: string, samples: number) {
  const root = projectRoot();
  await execFileAsync(
    pythonCmd(),
    [
      "register_faces.py",
      "--name",
      rollNumber,
      "--samples",
      String(samples),
      "--camera-index",
      cameraIndex(),
      "--no-preview",
      "--max-seconds",
      String(captureTimeoutSec()),
      "--fallback-center-crop"
    ],
    {
      cwd: root,
      windowsHide: false,
      maxBuffer: 20 * 1024 * 1024,
      timeout: (captureTimeoutSec() + 15) * 1000
    }
  );
}

export async function rebuildEmbeddings() {
  const root = projectRoot();
  await execFileAsync(pythonCmd(), ["build_embeddings.py"], {
    cwd: root,
    windowsHide: false,
    maxBuffer: 20 * 1024 * 1024
  });
}

export function rebuildEmbeddingsInBackground() {
  const root = projectRoot();
  const child = spawn(pythonCmd(), ["build_embeddings.py"], {
    cwd: root,
    windowsHide: false,
    stdio: "ignore",
    detached: true
  });
  child.unref();
}

export async function scanAttendanceFromFrames(
  framesDir: string,
  allowedRolls: string[],
  threshold = 0.45
) {
  const root = projectRoot();
  const { stdout } = await execFileAsync(
    pythonCmd(),
    [
      "scan_attendance.py",
      "--frames-dir",
      framesDir,
      "--allowed-rolls",
      allowedRolls.join(","),
      "--threshold",
      String(threshold)
    ],
    {
      cwd: root,
      windowsHide: false,
      maxBuffer: 20 * 1024 * 1024
    }
  );
  return JSON.parse(stdout || "{}") as { present_rolls?: string[] };
}
