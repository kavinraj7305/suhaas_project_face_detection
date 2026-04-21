"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [role, setRole] = useState<"teacher" | "student">("teacher");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(mode === "login" ? "Signing in..." : "Creating teacher account...");

    if (mode === "register") {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: identifier, password })
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
  }

  return (
    <main>
      <div className="card" style={{ maxWidth: 560, margin: "48px auto" }}>
        <h1>Attendance Portal</h1>
        <p>
          {mode === "login"
            ? "Teacher login uses name, student login uses roll number."
            : "Teacher self-registration (first time only)."}
        </p>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <button type="button" className={mode === "login" ? "" : "button-ghost"} onClick={() => setMode("login")}>
            Login
          </button>
          <button
            type="button"
            className={mode === "register" ? "button-secondary" : "button-ghost"}
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
            {mode === "register" ? "Teacher Name" : role === "teacher" ? "Teacher Name" : "Roll Number"}
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit">{mode === "login" ? "Login" : "Register Teacher"}</button>
        </form>
        {message ? <p className="message-banner">{message}</p> : null}
      </div>
    </main>
  );
}
