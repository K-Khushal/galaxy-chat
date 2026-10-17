import { Code2, Compass, FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const starters = [
  {
    icon: Code2,
    title: "Think through code",
    prompt: "Help me think through a technical problem step by step.",
  },
  {
    icon: FileText,
    title: "Make an idea clearer",
    prompt: "Help me turn a rough idea into a clear, concise plan.",
  },
  {
    icon: Compass,
    title: "Explore a question",
    prompt: "Help me explore a question from a few different perspectives.",
  },
];
export function EmptyConversation({
  onPrompt,
}: {
  onPrompt?: (prompt: string) => void;
}) {
  return (
    <div className="m-auto w-full max-w-2xl px-2 py-4 sm:px-4 sm:py-12">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-border bg-card shadow-xs">
        <Sparkles className="size-6 text-primary" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-medium tracking-tight sm:text-4xl">
        What are you working on?
      </h1>
      <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
        Work through a problem, shape an idea, or follow your curiosity.
      </p>
      {onPrompt && (
        <div className="mt-6 grid gap-2 sm:grid-cols-3">
          {starters.map(({ icon: Icon, title, prompt }) => (
            <Button
              key={title}
              variant="outline"
              className="h-auto min-h-14 flex-row justify-start gap-3 whitespace-normal bg-card px-4 py-3 text-left font-normal sm:min-h-20 sm:flex-col sm:items-start sm:py-4"
              onClick={() => onPrompt(prompt)}
            >
              <Icon
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              {title}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
