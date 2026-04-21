import { requireTeacher } from "@/lib/auth";
import TeacherDashboard from "@/components/TeacherDashboard";

export default function TeacherPage() {
  const user = requireTeacher();
  return (
    <main>
      <TeacherDashboard teacherName={user.name} />
    </main>
  );
}
