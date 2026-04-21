"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [role, setRole] = useState<"teacher" | "student">("teacher");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(mode === "login" ? "Signing in..." : "Creating teacher account...");

    try {
      if (mode === "register") {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: identifier, password })
        });

        const data = await response.json();
        if (!response.ok) {
          setMessage(data.error || "Registration failed");
          return;
        }

        window.location.href = "/teacher";
        return;
      }

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, identifier, password })
      });

      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || "Login failed");
        return;
      }

      window.location.href = role === "teacher" ? "/teacher" : "/student";
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <div className="auth-shell">
        <section className="auth-left">
          <h1>AI Attendance Portal</h1>
          <p>
            Manage students, capture face data, run attendance scans, and process OD requests in one dashboard.
            This portal supports both teacher and student access with role-based workflow.
          </p>
        </section>

        <section className="auth-right">
          <h2 style={{ marginTop: 0 }}>Get Started</h2>
          <p>
            {mode === "login"
              ? "Teacher login uses email, student login uses roll number."
              : "Teacher self-registration (email + password)."}
          </p>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className={mode === "login" ? "" : "button-ghost"}
              disabled={submitting}
              onClick={() => setMode("login")}
            >
              Login
            </button>
            <button
              type="button"
              className={mode === "register" ? "button-secondary" : "button-ghost"}
              disabled={submitting}
              onClick={() => {
                setMode("register");
                setRole("teacher");
              }}
            >
              Register Teacher
            </button>
          </div>
          <form onSubmit={onSubmit}>
            {mode === "login" ? (
              <label>
                Role
                <select value={role} onChange={(e) => setRole(e.target.value as "teacher" | "student")}>
                  <option value="teacher">Teacher</option>
                  <option value="student">Student</option>
                </select>
              </label>
            ) : null}
            <label>
              {mode === "register" ? "Teacher Email" : role === "teacher" ? "Teacher Email" : "Roll Number"}
              <input
                type={role === "teacher" || mode === "register" ? "email" : "text"}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? "Please wait..." : mode === "login" ? "Login" : "Register Teacher"}
            </button>
          </form>
          {message ? <p className="message-banner">{message}</p> : null}
        </section>
      </div>
    </main>
  );
}
