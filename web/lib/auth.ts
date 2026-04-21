import { compare, hash } from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE_NAME = "attendance_token";

export type SessionUser = {
  userId: number;
  role: "teacher" | "student";
  name: string;
  rollNumber?: string;
};

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
  return process.env.JWT_SECRET;
}

export async function hashPassword(plainText: string) {
  return hash(plainText, 10);
}

export async function verifyPassword(plainText: string, passwordHash: string) {
  return compare(plainText, passwordHash);
}

export function signToken(payload: SessionUser) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
}

export function verifyToken(token: string): SessionUser | null {
  try {
    return jwt.verify(token, getJwtSecret()) as SessionUser;
  } catch {
    return null;
  }
}

export function setSessionCookie(token: string) {
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60
  });
}

export function clearSessionCookie() {
  cookies().delete(COOKIE_NAME);
}

export function getSessionUser(): SessionUser | null {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export function requireTeacher() {
  const user = getSessionUser();
  if (!user || user.role !== "teacher") {
    redirect("/");
  }
  return user;
}

export function requireStudent() {
  const user = getSessionUser();
  if (!user || user.role !== "student") {
    redirect("/");
  }
  return user;
}
