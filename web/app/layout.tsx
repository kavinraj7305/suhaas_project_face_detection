import "./globals.css";

export const metadata = {
  title: "Attendance Portal",
  description: "Teacher and student attendance portal"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
