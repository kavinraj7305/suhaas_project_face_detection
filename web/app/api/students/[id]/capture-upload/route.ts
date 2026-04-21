import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { rebuildEmbeddingsInBackground } from "@/lib/python";

function datasetPathFor(rollNumber: string) {
  return resolve(process.cwd(), "..", "dataset", rollNumber.toLowerCase());
}

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

  const rollNumber = String(row.rows[0].roll_number);
  const outDir = datasetPathFor(rollNumber);
  await mkdir(outDir, { recursive: true });

  const ts = Date.now();
  let saved = 0;
  for (let i = 0; i < images.length; i += 1) {
    const dataUrl = String(images[i]);
    const commaIndex = dataUrl.indexOf(",");
    if (commaIndex === -1) continue;
    const base64 = dataUrl.slice(commaIndex + 1);
    const buffer = Buffer.from(base64, "base64");
    const outPath = join(outDir, `web_${ts}_${String(i + 1).padStart(3, "0")}.jpg`);
    await writeFile(outPath, buffer);
    saved += 1;
  }

  if (saved === 0) {
    return NextResponse.json({ error: "No valid images uploaded" }, { status: 400 });
  }

  rebuildEmbeddingsInBackground();
  return NextResponse.json({ ok: true, saved, embeddingStatus: "queued" });
}
