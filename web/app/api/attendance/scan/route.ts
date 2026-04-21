import { mkdir, rm, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { scanAttendanceFromFrames } from "@/lib/python";
import { todayDateString } from "@/lib/date";

export async function GET(req: Request) {
  const user = getSessionUser();
  if (!user || user.role !== "teacher") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const day = searchParams.get("day");

  const query = day
    ? `SELECT id, day, report_json, created_at
       FROM attendance_scans
       WHERE teacher_id = $1 AND day = $2
       ORDER BY created_at DESC
       LIMIT 10`
    : `SELECT id, day, report_json, created_at
       FROM attendance_scans
       WHERE teacher_id = $1
       ORDER BY created_at DESC
       LIMIT 10`;
  const params = day ? [user.userId, day] : [user.userId];
  const rows = await db.query(query, params);
  return NextResponse.json({ scans: rows.rows });
}

export async function POST(req: Request) {
  const user = getSessionUser();
  if (!user || user.role !== "teacher") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const images = Array.isArray(body.images) ? body.images : [];
  const day = String(body.day || todayDateString());
  if (images.length === 0) {
    return NextResponse.json({ error: "No frames provided" }, { status: 400 });
  }

  const studentsRes = await db.query(
    `SELECT s.id AS student_id, s.roll_number
     FROM students s
     WHERE s.teacher_id = $1
     ORDER BY s.roll_number ASC`,
    [user.userId]
  );
  const students = studentsRes.rows as { student_id: number; roll_number: string }[];
  if (students.length === 0) {
    return NextResponse.json({ error: "No students found for teacher" }, { status: 400 });
  }

  const allowedRolls = students.map((s) => s.roll_number.toLowerCase());
  const tempDir = resolve(process.cwd(), "..", "temp_frames", `${user.userId}-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  try {
    let written = 0;
    for (let i = 0; i < images.length; i += 1) {
      const dataUrl = String(images[i]);
      const comma = dataUrl.indexOf(",");
      if (comma === -1) continue;
      const base64 = dataUrl.slice(comma + 1);
      const buffer = Buffer.from(base64, "base64");
      const outPath = join(tempDir, `frame_${String(i + 1).padStart(3, "0")}.jpg`);
      await writeFile(outPath, buffer);
      written += 1;
    }

    if (!written) {
      return NextResponse.json({ error: "No valid frames" }, { status: 400 });
    }

    const scan = await scanAttendanceFromFrames(tempDir, allowedRolls, 0.45);
    const presentRolls = new Set((scan.present_rolls || []).map((r) => r.toLowerCase()));

    const odRes = await db.query(
      `SELECT s.roll_number
       FROM od_requests o
       JOIN students s ON s.id = o.student_id
       WHERE s.teacher_id = $1
         AND o.day = $2
         AND o.decision = 'approved'`,
      [user.userId, day]
    );
    const odRolls = new Set((odRes.rows as { roll_number: string }[]).map((r) => r.roll_number.toLowerCase()));

    const statusRows: { rollNumber: string; status: "present" | "absent" | "od" }[] = [];
    for (const student of students) {
      const roll = student.roll_number.toLowerCase();
      const status: "present" | "absent" | "od" = odRolls.has(roll)
        ? "od"
        : presentRolls.has(roll)
          ? "present"
          : "absent";
      statusRows.push({ rollNumber: student.roll_number, status });

      await db.query(
        `INSERT INTO attendance (student_id, day, status)
         VALUES ($1, $2, $3)
         ON CONFLICT (student_id, day)
         DO UPDATE SET status = EXCLUDED.status`,
        [student.student_id, day, status]
      );
    }

    await db.query(
      `INSERT INTO attendance_scans (teacher_id, day, report_json)
       VALUES ($1, $2, $3::jsonb)`,
      [user.userId, day, JSON.stringify(statusRows)]
    );

    return NextResponse.json({
      ok: true,
      day,
      report: statusRows
    });
  } catch (error) {
    return NextResponse.json({ error: "Attendance scan failed", details: String(error) }, { status: 500 });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
