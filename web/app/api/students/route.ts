import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, hashPassword } from "@/lib/auth";

export async function GET() {
  const user = getSessionUser();
  if (!user || user.role !== "teacher") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.query(
    `SELECT s.id, u.name, s.roll_number, s.section, s.department, s.passing_out_year
     FROM students s
     JOIN users u ON u.id = s.user_id
     WHERE s.teacher_id = $1
     ORDER BY s.roll_number ASC`,
    [user.userId]
  );
  return NextResponse.json({ students: rows.rows });
}

export async function POST(req: Request) {
  const user = getSessionUser();
  if (!user || user.role !== "teacher") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const name = String(body.name || "").trim();
  const rollNumber = String(body.rollNumber || "").trim().toUpperCase();
  const section = String(body.section || "").trim();
  const department = String(body.department || "").trim();
  const passingOutYear = Number(body.passingOutYear);

  if (!name || !rollNumber || !section || !department || !passingOutYear) {
    return NextResponse.json({ error: "Missing student fields" }, { status: 400 });
  }

  const plainPassword = `${rollNumber}${name.replace(/\s+/g, "")}`;
  const passwordHash = await hashPassword(plainPassword);
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const userInsert = await client.query(
      `INSERT INTO users (name, role, roll_number, password_hash)
       VALUES ($1, 'student', $2, $3)
       RETURNING id`,
      [name, rollNumber, passwordHash]
    );
    await client.query(
      `INSERT INTO students (user_id, teacher_id, roll_number, section, department, passing_out_year)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userInsert.rows[0].id, user.userId, rollNumber, section, department, passingOutYear]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Student creation failed", details: String(error) }, { status: 500 });
  } finally {
    client.release();
  }

  return NextResponse.json({
    ok: true,
    generatedPassword: plainPassword,
    info: "Student created. Use Open Camera button to capture photos from browser webcam."
  });
}
