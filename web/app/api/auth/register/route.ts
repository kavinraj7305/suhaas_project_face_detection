import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, setSessionCookie, signToken } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    const existing = await db.query(
      "SELECT id FROM users WHERE role='teacher' AND LOWER(email)=LOWER($1)",
      [email]
    );
    if (existing.rowCount) {
      return NextResponse.json({ error: "Teacher with this email already exists" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const derivedName = email.split("@")[0];
    const inserted = await db.query(
      `INSERT INTO users (name, email, role, password_hash)
       VALUES ($1, $2, 'teacher', $3)
       RETURNING id, name, role`,
      [derivedName, email, passwordHash]
    );

    const teacher = inserted.rows[0];
    const token = signToken({
      userId: teacher.id,
      name: teacher.name,
      role: teacher.role
    });
    setSessionCookie(token);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Teacher registration failed", details: String(error) },
      { status: 500 }
    );
  }
}
