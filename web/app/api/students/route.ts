import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, hashPassword } from "@/lib/auth";
import { generatePassword } from "@/lib/password";
import { captureStudentPhotos, rebuildEmbeddings } from "@/lib/python";

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
  const samples = Number(body.samples || 40);

  if (!name || !rollNumber || !section || !department || !passingOutYear || samples < 1) {
    return NextResponse.json({ error: "Missing student fields" }, { status: 400 });
  }

  const plainPassword = generatePassword(10);
  const passwordHash = await hashPassword(plainPassword);
  let createdUserId: number | null = null;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const userInsert = await client.query(
      `INSERT INTO users (name, role, roll_number, password_hash)
       VALUES ($1, 'student', $2, $3)
       RETURNING id`,
      [name, rollNumber, passwordHash]
    );
    createdUserId = userInsert.rows[0].id as number;

    await client.query(
      `INSERT INTO students (user_id, teacher_id, roll_number, section, department, passing_out_year)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [createdUserId, user.userId, rollNumber, section, department, passingOutYear]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Student creation failed", details: String(error) }, { status: 500 });
  } finally {
    client.release();
  }

  try {
    await captureStudentPhotos(rollNumber, samples);
    await rebuildEmbeddings();
  } catch (error) {
    if (createdUserId) {
      await db.query("DELETE FROM users WHERE id = $1", [createdUserId]);
    }
    return NextResponse.json(
      {
        error: "Student photos/embeddings failed. Student creation was reverted.",
        details: String(error)
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    generatedPassword: plainPassword,
    info: "Photos captured and embeddings rebuilt."
  });
}
