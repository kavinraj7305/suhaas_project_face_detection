import { randomUUID } from "crypto";
import { writeFile } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { todayDateString } from "@/lib/date";

export async function GET() {
  const user = getSessionUser();
  if (!user || user.role !== "teacher") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.query(
    `SELECT o.id, o.day, o.reason, o.letter_image_path, o.decision, o.created_at,
            s.roll_number, u.name
     FROM od_requests o
     JOIN students s ON s.id = o.student_id
     JOIN users u ON u.id = s.user_id
     WHERE s.teacher_id = $1
     ORDER BY o.created_at DESC`,
    [user.userId]
  );
  return NextResponse.json({ requests: rows.rows });
}

export async function POST(req: Request) {
  const user = getSessionUser();
  if (!user || user.role !== "student") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const rollNumber = String(formData.get("rollNumber") || "").trim().toUpperCase();
  const reason = String(formData.get("reason") || "").trim();
  const day = String(formData.get("day") || todayDateString());
  const image = formData.get("letter");

  if (!rollNumber || !reason || !image || !(image instanceof File)) {
    return NextResponse.json({ error: "Missing OD form fields" }, { status: 400 });
  }

  const studentRes = await db.query("SELECT id FROM students WHERE roll_number = $1", [rollNumber]);
  if (studentRes.rowCount === 0) {
    return NextResponse.json({ error: "Roll number not found" }, { status: 404 });
  }

  const bytes = await image.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const fileName = `${Date.now()}-${randomUUID()}.png`;
  const outputPath = join(process.cwd(), "public", "uploads", fileName);
  await writeFile(outputPath, buffer);

  await db.query(
    `INSERT INTO od_requests (student_id, day, reason, letter_image_path)
     VALUES ($1, $2, $3, $4)`,
    [studentRes.rows[0].id, day, reason, `/uploads/${fileName}`]
  );

  return NextResponse.json({ ok: true });
}
