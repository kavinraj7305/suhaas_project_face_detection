import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = getSessionUser();
  if (!user || user.role !== "teacher") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestId = Number(params.id);
  const body = await req.json();
  const decision = String(body.decision || "");

  if (!requestId || !["approved", "rejected"].includes(decision)) {
    return NextResponse.json({ error: "Invalid decision payload" }, { status: 400 });
  }

  const odResult = await db.query(
    `UPDATE od_requests
     SET decision = $1, reviewed_by = $2, reviewed_at = NOW()
     WHERE id = $3
     RETURNING student_id, day`,
    [decision, user.userId, requestId]
  );

  if (odResult.rowCount === 0) {
    return NextResponse.json({ error: "OD request not found" }, { status: 404 });
  }

  if (decision === "approved") {
    await db.query(
      `INSERT INTO attendance (student_id, day, status)
       VALUES ($1, $2, 'od')
       ON CONFLICT (student_id, day)
       DO UPDATE SET status = 'od'`,
      [odResult.rows[0].student_id, odResult.rows[0].day]
    );
  }

  return NextResponse.json({ ok: true });
}
