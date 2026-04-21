import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, setSessionCookie, signToken } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    const password = String(body.password || "");

    if (!name || !password) {
      return NextResponse.json({ error: "Name and password are required" }, { status: 400 });
    }

    const existing = await db.query(
      "SELECT id FROM users WHERE role='teacher' AND LOWER(name)=LOWER($1)",
      [name]
    );
    if (existing.rowCount) {
      return NextResponse.json({ error: "Teacher already exists" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const inserted = await db.query(
      `INSERT INTO users (name, role, password_hash)
       VALUES ($1, 'teacher', $2)
       RETURNING id, name, role`,
      [name, passwordHash]
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
