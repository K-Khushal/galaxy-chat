import { Composer } from "@/components/shell/composer";

export default function NewChatPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="flex w-full max-w-3xl flex-col items-center gap-6 pb-[8vh] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300">
        <h1 className="text-center text-3xl font-medium tracking-tight text-balance">
          What can I help with?
        </h1>
        <Composer />
      </div>
    </div>
  );
}
