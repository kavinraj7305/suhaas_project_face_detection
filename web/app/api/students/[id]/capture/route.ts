import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { captureStudentPhotos, rebuildEmbeddings } from "@/lib/python";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = getSessionUser();
  if (!user || user.role !== "teacher") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const studentId = Number(params.id);
  const body = await req.json();
  const samples = Number(body.samples || 40);
  if (!studentId || samples < 1) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const row = await db.query(
    "SELECT roll_number FROM students WHERE id = $1 AND teacher_id = $2",
    [studentId, user.userId]
  );
  if (!row.rowCount) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  try {
    await captureStudentPhotos(row.rows[0].roll_number, samples);
    await rebuildEmbeddings();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "Capture failed", details: String(error) }, { status: 500 });
  }
}
