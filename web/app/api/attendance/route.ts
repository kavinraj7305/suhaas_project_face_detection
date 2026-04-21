import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { todayDateString } from "@/lib/date";

export async function GET(req: Request) {
  const user = getSessionUser();
  if (!user || user.role !== "teacher") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const day = searchParams.get("day") || todayDateString();
  const rows = await db.query(
    `SELECT s.id AS student_id, u.name, s.roll_number, COALESCE(a.status, 'absent') AS status
     FROM students s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN attendance a ON a.student_id = s.id AND a.day = $2
     WHERE s.teacher_id = $1
     ORDER BY s.roll_number ASC`,
    [user.userId, day]
  );
  return NextResponse.json({ day, rows: rows.rows });
}

export async function POST(req: Request) {
  const user = getSessionUser();
  if (!user || user.role !== "teacher") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const studentId = Number(body.studentId);
  const day = String(body.day || todayDateString());
  const status = String(body.status || "absent");

  if (!studentId || !["present", "absent", "od"].includes(status)) {
    return NextResponse.json({ error: "Invalid attendance payload" }, { status: 400 });
  }

  await db.query(
    `INSERT INTO attendance (student_id, day, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (student_id, day)
     DO UPDATE SET status = EXCLUDED.status`,
    [studentId, day, status]
  );
  return NextResponse.json({ ok: true });
}
