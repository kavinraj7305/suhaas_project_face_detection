import { requireStudent } from "@/lib/auth";
import StudentDashboard from "@/components/StudentDashboard";

export default function StudentPage() {
  const user = requireStudent();
  return (
    <main>
      <StudentDashboard studentName={user.name} rollNumber={user.rollNumber || ""} />
    </main>
  );
}
