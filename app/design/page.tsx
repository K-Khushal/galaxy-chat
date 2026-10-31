import { notFound } from "next/navigation";
import { Overlays } from "@/components/design/overlays";
import { Showcase } from "@/components/design/showcase";
import { ThemeSwitcher } from "@/components/shell/theme-switcher";

export const metadata = { title: "Design system" };

function ThemePanel({
  theme,
  label,
}: {
  theme: "light" | "dark";
  label: string;
}) {
  return (
    <section
      aria-label={`${label} theme`}
      data-pane={theme}
      className={`${theme} min-w-0 rounded-2xl border bg-background p-6 text-foreground`}
    >
      <h2 className="mb-6 text-lg font-medium tracking-tight">{label}</h2>
      <Showcase />
    </section>
  );
}

// Dev-only: production builds answer 404.
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto flex max-w-[1400px] flex-col gap-8 p-4 sm:p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Design system</h1>
          <p className="mt-1 max-w-prose text-muted-foreground">
            Every primitive and state, rendered in both themes. Tab through the
            page to check focus rings.
          </p>
        </div>
        <ThemeSwitcher />
      </header>
      <div className="grid gap-6 xl:grid-cols-2">
        <ThemePanel theme="light" label="Light" />
        <ThemePanel theme="dark" label="Dark" />
      </div>
      <Overlays />
    </main>
  );
}
