"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

/** Wait this long after filter typing stops before refetching (avoids API spam per keystroke). */
const FILTER_DEBOUNCE_MS = 450;

type Student = {
  id: number;
  name: string;
  roll_number: string;
  section: string;
  department: string;
  passing_out_year: number;
};

type AttendanceRow = {
  student_id: number;
  name: string;
  roll_number: string;
  status: "present" | "absent" | "od";
};

type OdRequest = {
  id: number;
  day: string;
  reason: string;
  letter_image_path: string;
  decision: "pending" | "approved" | "rejected";
  roll_number: string;
  name: string;
};

type ScanStatusRow = {
  rollNumber: string;
  status: "present" | "absent" | "od";
};

type ScanSummary = {
  present: number;
  absent: number;
  od: number;
};

type StoredScan = {
  id: number;
  day: string;
  report_json:
    | ScanStatusRow[]
    | {
        scanSeconds?: number;
        section?: string | null;
        department?: string | null;
        passingOutYear?: number | null;
        summary?: { present: number; absent: number; od: number };
        rows?: ScanStatusRow[];
      };
  created_at: string;
};

function statusBadgeClass(status: "present" | "absent" | "od" | "pending" | "approved" | "rejected") {
  if (status === "present") return "status-badge status-present";
  if (status === "absent") return "status-badge status-absent";
  if (status === "od") return "status-badge status-od";
  if (status === "pending") return "status-badge status-pending";
  if (status === "approved") return "status-badge status-present";
  return "status-badge status-absent";
}

export default function TeacherDashboard({ teacherName }: { teacherName: string }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [odRequests, setOdRequests] = useState<OdRequest[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [captureTarget, setCaptureTarget] = useState<{ id: number; roll: string } | null>(null);
  const [captureSamples, setCaptureSamples] = useState(20);
  const [scanMode, setScanMode] = useState(false);
  const [scanSecondsLeft, setScanSecondsLeft] = useState(10);
  const [scanDurationSec, setScanDurationSec] = useState(10);
  const [scanSection, setScanSection] = useState("");
  const [scanDepartment, setScanDepartment] = useState("");
  const [scanYear, setScanYear] = useState<number | "">("");
  /** Applied to API fetches only after debounce; inputs stay live for the Take Attendance action. */
  const [appliedSection, setAppliedSection] = useState("");
  const [appliedDepartment, setAppliedDepartment] = useState("");
  const [appliedYear, setAppliedYear] = useState<number | "">("");
  const [scanReport, setScanReport] = useState<ScanStatusRow[]>([]);
  const [scanSummary, setScanSummary] = useState<ScanSummary | null>(null);
  const [scanHistory, setScanHistory] = useState<StoredScan[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loadingData, setLoadingData] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  async function loadAll() {
    setLoadingData(true);
    try {
      const [studentsRes, attendanceRes, odRes, scanRes] = await Promise.all([
        fetch("/api/students"),
        fetch(`/api/attendance?day=${date}`),
        fetch("/api/od-requests"),
        fetch(
          `/api/attendance/scan?day=${date}&section=${encodeURIComponent(appliedSection)}&department=${encodeURIComponent(
            appliedDepartment
          )}&passingOutYear=${appliedYear || 0}`
        )
      ]);
      const studentsData = await studentsRes.json();
      const attendanceData = await attendanceRes.json();
      const odData = await odRes.json();
      const scanData = await scanRes.json();

      setStudents(studentsData.students || []);
      setAttendance(attendanceData.rows || []);
      setOdRequests(odData.requests || []);
      setScanHistory(scanData.scans || []);
      setScanReport(scanData?.report?.rows || []);
      setScanSummary(scanData?.report?.summary || null);
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => {
    const id = window.setTimeout(() => {
      setAppliedSection(scanSection);
      setAppliedDepartment(scanDepartment);
      setAppliedYear(scanYear);
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [scanSection, scanDepartment, scanYear]);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, appliedSection, appliedDepartment, appliedYear]);

  async function addStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      name: form.get("name"),
      rollNumber: form.get("rollNumber"),
      section: form.get("section"),
      department: form.get("department"),
      passingOutYear: form.get("passingOutYear")
    };
    setMessage("Creating student...");
    try {
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.details ? String(data.details).split("\n")[0] : "";
        setMessage(`${data.error || "Failed to add student"} ${detail}`.trim());
        return;
      }
      setMessage(
        `Student created. Generated password: ${data.generatedPassword}. Now click Open Camera for this student.`
      );
      formElement.reset();
      await loadAll();
    } finally {
      setBusy(false);
    }
  }

  function stopBrowserCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  async function openBrowserCamera(studentId: number, rollNumber: string) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Browser camera API not supported.");
      return;
    }
    setCaptureTarget({ id: studentId, roll: rollNumber });
    setMessage(`Allow camera permission, then capture ${captureSamples} photos.`);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error) {
      setCaptureTarget(null);
      setMessage(`Unable to access browser camera: ${String(error)}`);
    }
  }

  async function captureFromBrowserAndUpload() {
    if (!captureTarget || !videoRef.current) return;
    setBusy(true);
    setMessage(`Capturing ${captureSamples} photos from browser camera...`);
    try {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      // Keep payload smaller for faster API round-trip.
      canvas.width = 480;
      canvas.height = 360;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas context unavailable");
      }

      const images: string[] = [];
      for (let i = 0; i < captureSamples; i += 1) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        images.push(canvas.toDataURL("image/jpeg", 0.7));
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }

      const res = await fetch(`/api/students/${captureTarget.id}/capture-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images })
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.details ? String(data.details).split("\n")[0] : "";
        setMessage(`${data.error || "Capture failed"} ${detail}`.trim());
        return;
      }
      setMessage(
        `Browser capture completed for ${captureTarget.roll}. Saved ${data.saved} photos. Embedding rebuild is running in background.`
      );
    } finally {
      stopBrowserCamera();
      setCaptureTarget(null);
      setBusy(false);
    }
  }

  async function startAttendanceScan() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Browser camera API not supported.");
      return;
    }
    setBusy(true);
    setScanMode(true);
    const duration = Math.max(3, Math.min(60, Number(scanDurationSec || 10)));
    setScanSecondsLeft(duration);
    setMessage(`Starting ${duration}-second attendance scan...`);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const video = videoRef.current;
      if (!video) throw new Error("Video not ready");
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 360;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas context unavailable");

      const images: string[] = [];
      const totalFrames = duration * 2;
      for (let i = 0; i < totalFrames; i += 1) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        images.push(canvas.toDataURL("image/jpeg", 0.7));
        const seconds = Math.max(0, duration - Math.floor((i + 1) / 2));
        setScanSecondsLeft(seconds);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      }

      const res = await fetch("/api/attendance/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          day: date,
          images,
          section: scanSection,
          department: scanDepartment,
          scanSeconds: duration,
          passingOutYear: scanYear || 0
        })
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.details ? String(data.details).split("\n")[0] : "";
        setMessage(`${data.error || "Attendance scan failed"} ${detail}`.trim());
        return;
      }

      setScanReport(data.report || []);
      const summary = data.summary || {
        present: (data.report || []).filter((r: ScanStatusRow) => r.status === "present").length,
        od: (data.report || []).filter((r: ScanStatusRow) => r.status === "od").length,
        absent: (data.report || []).filter((r: ScanStatusRow) => r.status === "absent").length
      };
      setScanSummary(summary);
      setMessage(
        `Attendance done for ${duration}s. Present: ${summary.present}, OD: ${summary.od}, Absent: ${summary.absent}`
      );
      await loadAll();
    } finally {
      stopBrowserCamera();
      setScanMode(false);
      setBusy(false);
    }
  }

  async function updateAttendance(studentId: number, status: "present" | "absent" | "od") {
    setBusy(true);
    await fetch("/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, day: date, status })
    });
    await loadAll();
    setBusy(false);
  }

  async function decideOd(id: number, decision: "approved" | "rejected") {
    setBusy(true);
    await fetch(`/api/od-requests/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision })
    });
    await loadAll();
    setBusy(false);
  }

  async function logout() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  const presentToday = attendance.filter((r) => r.status === "present").length;
  const odToday = attendance.filter((r) => r.status === "od").length;
  const absentToday = attendance.filter((r) => r.status === "absent").length;
  const pendingOd = odRequests.filter((r) => r.decision === "pending").length;

  return (
    <>
      <div className="card hero-card">
        <h1>Teacher Dashboard</h1>
        <p>Welcome, {teacherName}</p>
        <div className="toolbar">
          <button className="button-ghost" onClick={logout}>
            Logout
          </button>
        </div>
      </div>

      {loadingData ? <p className="message-banner">Loading dashboard data...</p> : null}

      <div className="grid-2">
        <div className="card">
          <h3>Today Overview</h3>
          <p>Present: {presentToday}</p>
          <p>OD: {odToday}</p>
          <p>Absent: {absentToday}</p>
        </div>
        <div className="card">
          <h3>Quick Stats</h3>
          <p>Total Students: {students.length}</p>
          <p>Pending OD Requests: {pendingOd}</p>
          <p>Saved Scan Reports: {scanHistory.length}</p>
        </div>
      </div>

      <div className="card">
        <h2>Take Attendance (10s Scan)</h2>
        <p>Date: {date}</p>
        <div className="form-grid" style={{ marginBottom: 8 }}>
          <label>
            Scan Duration (seconds)
            <input
              type="number"
              min={3}
              max={60}
              value={scanDurationSec}
              onChange={(e) => setScanDurationSec(Number(e.target.value || 10))}
              placeholder="10"
            />
          </label>
          <label>
            Class / Section
            <input
              value={scanSection}
              onChange={(e) => setScanSection(e.target.value)}
              placeholder="e.g. A"
            />
          </label>
          <label>
            Passing Out Year
            <input
              type="number"
              value={scanYear}
              onChange={(e) => setScanYear(e.target.value ? Number(e.target.value) : "")}
              placeholder="e.g. 2027"
            />
          </label>
          <label>
            Department
            <input
              value={scanDepartment}
              onChange={(e) => setScanDepartment(e.target.value)}
              placeholder="e.g. CSE"
            />
          </label>
        </div>
        <p style={{ marginTop: 0 }}>
          Selected filter {"->"} Class: <strong>{scanSection || "All"}</strong>, Year:{" "}
          <strong>{scanYear || "All"}</strong>, Department: <strong>{scanDepartment || "All"}</strong>
        </p>
        <button disabled={busy} onClick={startAttendanceScan}>
          {busy && scanMode ? `Scanning... ${scanSecondsLeft}s` : "Take Attendance"}
        </button>
        {scanMode ? (
          <div style={{ marginTop: 12 }}>
            <video ref={videoRef} style={{ width: 320, borderRadius: 8 }} autoPlay playsInline muted />
          </div>
        ) : null}
        {scanReport.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <h3 style={{ marginBottom: 8 }}>Latest Scan Report</h3>
            <div className="grid-2" style={{ marginBottom: 10 }}>
              <div className="card" style={{ margin: 0 }}>
                <strong>Present</strong>
                <p style={{ margin: 0 }}>{scanSummary?.present ?? 0}</p>
              </div>
              <div className="card" style={{ margin: 0 }}>
                <strong>OD</strong>
                <p style={{ margin: 0 }}>{scanSummary?.od ?? 0}</p>
              </div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <strong>Absent</strong>
              <p style={{ margin: 0 }}>{scanSummary?.absent ?? 0}</p>
            </div>
            <table style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Roll Number</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {scanReport.map((row) => (
                  <tr key={row.rollNumber}>
                    <td>{row.rollNumber}</td>
                    <td>
                      <span className={statusBadgeClass(row.status)}>{row.status.toUpperCase()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ marginTop: 12 }}>No scan report yet for this date/filter.</p>
        )}
        {scanHistory.length > 0 ? (
          <div style={{ marginTop: 16 }}>
            <h3>Stored Scan Reports ({date})</h3>
            {scanHistory.map((scan) => (
              <div key={scan.id} style={{ marginBottom: 12, padding: 8, border: "1px solid #e5e7eb", borderRadius: 8 }}>
                <p style={{ margin: "0 0 8px 0" }}>
                  Scan at: {new Date(scan.created_at).toLocaleString()}
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Roll</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {((Array.isArray(scan.report_json) ? scan.report_json : scan.report_json.rows || []) || []).map((row) => (
                      <tr key={`${scan.id}-${row.rollNumber}`}>
                        <td>{row.rollNumber}</td>
                        <td>
                          <span className={statusBadgeClass(row.status)}>{row.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2>Add Student</h2>
        <form className="form-grid" onSubmit={addStudent}>
          <input name="name" placeholder="Student name" required />
          <input name="rollNumber" placeholder="Roll number" required />
          <input name="section" placeholder="Section" required />
          <input name="department" placeholder="Department" required />
          <input name="passingOutYear" type="number" placeholder="Passing out year" required />
          <button type="submit" disabled={busy}>
            {busy ? "Creating..." : "Create Student"}
          </button>
        </form>
        {message ? <p className="message-banner">{message}</p> : null}
      </div>

      <div className="card">
        <h2>Students</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Roll</th>
              <th>Section</th>
              <th>Department</th>
              <th>Year</th>
              <th>Photos</th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr key={student.id}>
                <td>{student.name}</td>
                <td>{student.roll_number}</td>
                <td>{student.section}</td>
                <td>{student.department}</td>
                <td>{student.passing_out_year}</td>
                <td>
                  <button disabled={busy} onClick={() => openBrowserCamera(student.id, student.roll_number)}>
                    Open Camera
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {captureTarget ? (
          <div style={{ marginTop: 16 }}>
            <h3>Camera Capture for {captureTarget.roll}</h3>
            <video ref={videoRef} style={{ width: 320, borderRadius: 8 }} autoPlay playsInline muted />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                type="number"
                min={10}
                max={100}
                value={captureSamples}
                onChange={(e) => setCaptureSamples(Number(e.target.value || 20))}
              />
              <button disabled={busy} onClick={captureFromBrowserAndUpload}>
                {busy ? "Capturing..." : "Capture + Upload"}
              </button>
              <button
                className="button-ghost"
                type="button"
                onClick={() => {
                  stopBrowserCamera();
                  setCaptureTarget(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2>Attendance ({date})</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Roll</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {attendance.map((row) => (
              <tr key={row.student_id}>
                <td>{row.name}</td>
                <td>{row.roll_number}</td>
                <td>
                  <span className={statusBadgeClass(row.status)}>{row.status}</span>
                </td>
                <td>
                  <div className="toolbar">
                    <button className="button-success" onClick={() => updateAttendance(row.student_id, "present")}>
                      Present
                    </button>
                    <button className="button-danger" onClick={() => updateAttendance(row.student_id, "absent")}>
                      Absent
                    </button>
                    <button className="button-secondary" onClick={() => updateAttendance(row.student_id, "od")}>
                      OD
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>OD Requests</h2>
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Day</th>
              <th>Reason</th>
              <th>Letter</th>
              <th>Decision</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {odRequests.map((request) => (
              <tr key={request.id}>
                <td>
                  {request.name} ({request.roll_number})
                </td>
                <td>{request.day.slice(0, 10)}</td>
                <td>{request.reason}</td>
                <td>
                  <a href={request.letter_image_path} target="_blank" rel="noreferrer">
                    View
                  </a>
                </td>
                <td>
                  <span className={statusBadgeClass(request.decision)}>{request.decision}</span>
                </td>
                <td>
                  {request.decision === "pending" ? (
                    <div className="toolbar">
                      <button className="button-success" onClick={() => decideOd(request.id, "approved")}>
                        Approve
                      </button>
                      <button className="button-danger" onClick={() => decideOd(request.id, "rejected")}>
                        Reject
                      </button>
                    </div>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
