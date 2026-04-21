import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { callPythonApi } from "@/lib/pythonApi";
import { todayDateString } from "@/lib/date";

export async function GET(req: Request) {
  const user = getSessionUser();
  if (!user || user.role !== "teacher") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const day = searchParams.get("day");
  const section = String(searchParams.get("section") || "").trim();
  const department = String(searchParams.get("department") || "").trim();
  const passingOutYear = Number(searchParams.get("passingOutYear") || 0);
  if (!day) {
    return NextResponse.json({ scans: [] });
  }

  try {
    const pythonData = await callPythonApi<{
      ok: boolean;
      scans: unknown[];
      report: {
        day: string;
        section: string | null;
        department: string | null;
        passingOutYear: number | null;
        summary: { present: number; absent: number; od: number };
        rows: { rollNumber: string; status: "present" | "absent" | "od" }[];
      };
    }>("/attendance/full-report/get", {
      teacher_id: user.userId,
      day,
      section,
      department,
      passing_out_year: passingOutYear
    });

    return NextResponse.json({
      scans: pythonData.scans || [],
      report: pythonData.report
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch report", details: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = getSessionUser();
  if (!user || user.role !== "teacher") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const images = Array.isArray(body.images) ? body.images : [];
  const day = String(body.day || todayDateString());
  const scanSeconds = Math.max(3, Number(body.scanSeconds || 10));
  const section = String(body.section || "").trim();
  const department = String(body.department || "").trim();
  const passingOutYear = Number(body.passingOutYear || 0);
  if (images.length === 0) {
    return NextResponse.json({ error: "No frames provided" }, { status: 400 });
  }

  try {
    const pythonData = await callPythonApi<{
      ok: boolean;
      day: string;
      scanSeconds: number;
      section: string | null;
      department: string | null;
      passingOutYear: number | null;
      summary: { present: number; absent: number; od: number };
      report: { rollNumber: string; status: "present" | "absent" | "od" }[];
    }>("/attendance/full-report", {
      teacher_id: user.userId,
      day,
      images,
      section,
      department,
      passing_out_year: passingOutYear,
      scan_seconds: scanSeconds,
      threshold: 0.45
    });

    return NextResponse.json({
      ...pythonData
    });
  } catch (error) {
    return NextResponse.json({ error: "Attendance scan failed", details: String(error) }, { status: 500 });
  }
}
