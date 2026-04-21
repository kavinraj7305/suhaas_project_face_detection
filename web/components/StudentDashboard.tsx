"use client";

import { FormEvent, useState } from "react";

export default function StudentDashboard({
  studentName,
  rollNumber
}: {
  studentName: string;
  rollNumber: string;
}) {
  const [message, setMessage] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function submitOd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    form.set("rollNumber", rollNumber);
    form.set("day", date);

    const res = await fetch("/api/od-requests", {
      method: "POST",
      body: form
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || "OD request failed");
      setSubmitting(false);
      return;
    }
    setMessage("OD request submitted.");
    (event.currentTarget as HTMLFormElement).reset();
    setSubmitting(false);
  }

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <>
      <div className="card hero-card">
        <h1>Student Dashboard</h1>
        <p>
          Welcome, {studentName} ({rollNumber})
        </p>
        <button className="button-ghost" disabled={loggingOut} onClick={logout}>
          {loggingOut ? "Logging out..." : "Logout"}
        </button>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Submit OD Request</h2>
          <p style={{ marginTop: 0, color: "#475569" }}>
            Fill the form carefully and upload your letter image for faculty approval.
          </p>
          <form onSubmit={submitOd}>
            <label>
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label>
              Reason
              <textarea name="reason" placeholder="Enter OD reason" required />
            </label>
            <label>
              Letter (image/png/jpg)
              <input type="file" name="letter" accept="image/*" required />
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit OD"}
            </button>
          </form>
          {message ? <p className="message-banner">{message}</p> : null}
        </div>

        <div className="card">
          <h2>Guidelines</h2>
          <p style={{ marginTop: 0 }}>
            Use this panel to submit official OD requests. Make sure your uploaded image is clear and readable.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Choose correct date before submit.</li>
            <li>Keep reason short and specific.</li>
            <li>Upload valid letter/proof image.</li>
            <li>Approval status will be reviewed by teacher.</li>
          </ul>
          <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "#eef2ff" }}>
            <strong>Student Info</strong>
            <p style={{ margin: "8px 0 0" }}>Name: {studentName}</p>
            <p style={{ margin: "4px 0 0" }}>Roll Number: {rollNumber}</p>
          </div>
        </div>
      </div>
    </>
  );
}
