import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { callPythonApi } from "@/lib/pythonApi";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = getSessionUser();
  if (!user || user.role !== "teacher") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const studentId = Number(params.id);
  const body = await req.json();
  const images = Array.isArray(body.images) ? body.images : [];
  if (!studentId || images.length === 0) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const row = await db.query(
    "SELECT roll_number FROM students WHERE id = $1 AND teacher_id = $2",
    [studentId, user.userId]
  );
  if (!row.rowCount) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const studentRes = await db.query(
    `SELECT s.roll_number, u.name
     FROM students s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.teacher_id = $2`,
    [studentId, user.userId]
  );
  if (!studentRes.rowCount) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }
  const student = studentRes.rows[0] as { roll_number: string; name: string };

  try {
    const pythonResponse = await callPythonApi<{
      ok: boolean;
      saved_images: number;
      embedding_count: number;
      point_id: string;
    }>(`/students/${student.roll_number.toLowerCase()}/images`, {
      images,
      student_name: student.name,
      teacher_id: String(user.userId),
      rebuild_embeddings: true
    });

    return NextResponse.json({
      ok: true,
      saved: pythonResponse.saved_images,
      embeddingCount: pythonResponse.embedding_count,
      pointId: pythonResponse.point_id
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Capture upload to Python API failed", details: String(error) },
      { status: 500 }
    );
  }
}
