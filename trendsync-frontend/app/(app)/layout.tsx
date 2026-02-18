import Sidebar from "@/components/layout/Sidebar";
import VoiceCompanion from "@/components/voice/VoiceCompanion";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen pastel-gradient relative overflow-hidden">
      {/* Floating orbs */}
      <div className="absolute top-0 -left-40 w-96 h-96 bg-white/30 rounded-full mix-blend-normal filter blur-3xl opacity-50 animate-float-1" />
      <div className="absolute top-40 -right-40 w-96 h-96 bg-[var(--pastel-accent)]/20 rounded-full mix-blend-normal filter blur-3xl opacity-40 animate-float-2" />
      <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-[var(--pastel-teal)]/20 rounded-full mix-blend-normal filter blur-3xl opacity-40 animate-float-3" />

      <Sidebar />
      <main className="relative ml-72 p-8 z-10">{children}</main>
      <VoiceCompanion />
    </div>
  );
}
