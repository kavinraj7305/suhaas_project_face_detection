import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { setSessionCookie, signToken, verifyPassword } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const role = body.role as "teacher" | "student";
    const identifier = String(body.identifier || "").trim();
    const password = String(body.password || "");

    if (!role || !identifier || !password) {
      return NextResponse.json({ error: "Missing login fields" }, { status: 400 });
    }

    const query =
      role === "teacher"
        ? "SELECT id, name, role, password_hash FROM users WHERE role='teacher' AND LOWER(name)=LOWER($1)"
        : "SELECT id, name, role, roll_number, password_hash FROM users WHERE role='student' AND LOWER(roll_number)=LOWER($1)";

    const result = await db.query(query, [identifier]);
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const user = result.rows[0];
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const token = signToken({
      userId: user.id,
      role: user.role,
      name: user.name,
      rollNumber: user.roll_number ?? undefined
    });
    setSessionCookie(token);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "Login failed", details: String(error) }, { status: 500 });
  }
}
