"use client";

import {
  ArrowUp,
  Bell,
  Download,
  MessageSquare,
  Monitor,
  Moon,
  Plus,
  Search,
  Sun,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";
import { Composer } from "@/components/chat/composer";
import { GalaxyMark, GitHubMark, GoogleMark } from "@/components/icons/brand";
import { ProviderIcon } from "@/components/icons/provider-icon";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldCounter,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Separator } from "@/components/ui/separator";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, InlineAlert } from "@/components/ui/state";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const focusRing = "border-ring ring-3 ring-ring/50";

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

const swatches = [
  ["background", "bg-background"],
  ["card", "bg-card"],
  ["popover", "bg-popover"],
  ["muted", "bg-muted"],
  ["accent", "bg-accent"],
  ["sidebar", "bg-sidebar"],
  ["user-bubble", "bg-user-bubble"],
  ["primary", "bg-primary"],
  ["destructive", "bg-destructive"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["foreground", "bg-foreground"],
  ["muted-fg", "bg-muted-foreground"],
  ["border", "bg-border"],
] as const;

const charts = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
] as const;

const variants = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "destructive-subtle",
  "link",
] as const;

const badgeVariants = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;

const providers = [
  "OpenAI",
  "Anthropic",
  "Google",
  "xAI",
  "DeepSeek",
  "Meta",
  "Qwen",
  "Mistral",
  "custom/model",
] as const;

const themes = [
  { value: "system", label: "System", icon: <Monitor /> },
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "dark", label: "Dark", icon: <Moon /> },
] as const;

const instructions =
  "Keep replies short. Use British spelling. Prefer tables to long lists. ".repeat(
    26,
  );

export function Showcase() {
  const uid = useId();
  const [theme, setTheme] =
    useState<(typeof themes)[number]["value"]>("system");
  const [pending, setPending] = useState(false);
  return (
    <div className="flex flex-col gap-10">
      <Block title="Colour tokens">
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {swatches.map(([name, cls]) => (
            <li key={name} className="flex flex-col gap-1.5">
              <span className={`h-10 rounded-lg border ${cls}`} />
              <span className="text-xs text-muted-foreground">{name}</span>
            </li>
          ))}
        </ul>
        <ul className="flex gap-3">
          {charts.map((cls, i) => (
            <li key={cls} className="flex flex-1 flex-col gap-1.5">
              <span className={`h-6 rounded-md ${cls}`} />
              <span className="text-xs text-muted-foreground">
                chart-{i + 1}
              </span>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Type roles">
        <div className="flex flex-col gap-2">
          <p className="text-display font-semibold">What can I help with?</p>
          <p className="text-heading font-semibold">Heading, 20px</p>
          <p className="text-title font-medium">Title, 16px</p>
          <p>Body, Geist 14px. Menus, labels, buttons and controls.</p>
          <p className="text-message">
            Message, Geist 15px with a looser line height for reading replies at
            length.
          </p>
          <p className="text-caption text-muted-foreground">
            Caption, 13px. Secondary lines, field errors and chips.
          </p>
          <p className="text-xs text-muted-foreground">
            Micro, 12px. Group headings and Kbd.
          </p>
          <p className="text-shimmer">Thinking…</p>
          <p className="tabular-nums">12 Credits left · $0.0042</p>
          <p>
            A{" "}
            <a
              className="text-primary underline underline-offset-4"
              href="#top"
            >
              link
            </a>{" "}
            and <code className="font-mono text-[0.85em]">inline code</code>.
          </p>
          <pre className="overflow-x-auto rounded-xl bg-muted p-3 font-mono text-caption">
            {"const reply = await generate(chat)"}
          </pre>
        </div>
      </Block>

      <Block title="Radius: 6 chips, 8 controls, 12 menus and cards, 16 dialogs, 24 composer">
        <div className="flex items-end gap-4">
          <div className="flex h-10 w-16 items-center justify-center rounded-md border bg-card text-xs">
            6
          </div>
          <div className="flex h-12 w-24 items-center justify-center rounded-lg border bg-card text-xs">
            8
          </div>
          <div className="flex h-16 w-24 items-center justify-center rounded-xl border bg-card text-xs">
            12
          </div>
          <div className="flex h-20 w-24 items-center justify-center rounded-2xl border bg-card text-xs shadow-xl">
            16
          </div>
          <div className="flex h-20 min-w-0 flex-1 items-center justify-center rounded-3xl border bg-card text-xs">
            24
          </div>
        </div>
      </Block>

      <Block title="Button: variants (default 36px)">
        <div className="flex flex-wrap items-center gap-2">
          {variants.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </div>
      </Block>
      <Block title="Button: disabled (every variant; solid fills go neutral)">
        <div className="flex flex-wrap items-center gap-2">
          {variants.map((variant) => (
            <Button key={variant} variant={variant} disabled>
              {variant}
            </Button>
          ))}
        </div>
      </Block>
      <Block title="Button: sizes (xs 24, sm 32, default 36, lg 40; 44px on touch)">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs">xs</Button>
          <Button size="sm">sm</Button>
          <Button>default</Button>
          <Button size="lg">lg</Button>
          <Button size="icon-xs" aria-label="Add">
            <Plus />
          </Button>
          <Button size="icon-sm" variant="outline" aria-label="Search">
            <Search />
          </Button>
          <Button size="icon" variant="outline" aria-label="Notifications">
            <Bell />
          </Button>
          <Button size="icon-lg" variant="secondary" aria-label="Download">
            <Download />
          </Button>
        </div>
      </Block>
      <Block title="Button: with icon, disabled, focus (forced)">
        <div className="flex flex-wrap items-center gap-2">
          <Button>
            <Plus data-icon="inline-start" />
            New chat
          </Button>
          <Button variant="destructive-subtle">
            <Trash2 data-icon="inline-start" />
            Delete
          </Button>
          <Button disabled>Disabled</Button>
          <Button variant="outline" disabled>
            Disabled
          </Button>
          <Button className={focusRing}>Focused</Button>
          <Button variant="outline" className={focusRing}>
            Focused
          </Button>
          <Button size="icon" className="rounded-full" aria-label="Send">
            <ArrowUp />
          </Button>
        </div>
      </Block>
      <Block title="Button: pending (spinner over the label, width held)">
        <div className="flex flex-wrap items-center gap-2">
          <Button pending>Save instructions</Button>
          <Button variant="outline" pending>
            Try again
          </Button>
          <Button variant="destructive" pending>
            Delete Chat
          </Button>
          <Button size="sm" variant="secondary" pending>
            Remove
          </Button>
          <Button
            variant="outline"
            pending={pending}
            onClick={() => {
              setPending(true);
              setTimeout(() => setPending(false), 1500);
            }}
          >
            Click to submit
          </Button>
        </div>
      </Block>

      <Block title="Fields">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel>Label</FieldLabel>
            <Input placeholder="Placeholder" />
          </Field>
          <Field>
            <FieldLabel>Filled</FieldLabel>
            <Input defaultValue="sk-or-…" />
          </Field>
          <Field>
            <FieldLabel>Focused (forced)</FieldLabel>
            <Input placeholder="Focused" className={focusRing} />
          </Field>
          <Field invalid>
            <FieldLabel>OpenRouter key</FieldLabel>
            <Input
              type="password"
              autoComplete="off"
              defaultValue="Not a key"
            />
            <FieldError>OpenRouter didn't accept this key.</FieldError>
          </Field>
          <Field disabled>
            <FieldLabel>Disabled</FieldLabel>
            <Input placeholder="Disabled" />
          </Field>
          <Field>
            <FieldLabel>Type DELETE to confirm</FieldLabel>
            <Input autoComplete="off" />
            <FieldDescription>
              This deletes your account, Chats and BYOK key.
            </FieldDescription>
          </Field>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-d-group`}>Input group</Label>
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                id={`${uid}-d-group`}
                placeholder="Search chats"
              />
            </InputGroup>
          </div>
          <Field className="sm:col-span-2">
            <FieldLabel>Textarea with counter</FieldLabel>
            <Textarea
              className="max-h-32"
              maxLength={2000}
              defaultValue={instructions.slice(0, 1850)}
            />
            <FieldCounter value={1850} max={2000} />
          </Field>
        </div>
      </Block>

      <Block title="Segmented control and Kbd">
        <div className="flex flex-wrap items-center gap-4">
          <SegmentedControl
            aria-label="Theme"
            value={theme}
            onValueChange={setTheme}
            options={[...themes]}
          />
          <div className="flex items-center gap-2 text-muted-foreground">
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
            Search
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>,</Kbd>
            </KbdGroup>
            Settings
          </div>
        </div>
      </Block>

      <Block title="Switch">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Switch id={`${uid}-s-off`} />
            <Label htmlFor={`${uid}-s-off`}>Off</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id={`${uid}-s-on`} defaultChecked />
            <Label htmlFor={`${uid}-s-on`}>On</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id={`${uid}-s-disabled`} disabled />
            <Label htmlFor={`${uid}-s-disabled`}>Disabled</Label>
          </div>
        </div>
      </Block>

      <Block title="Badge">
        <div className="flex flex-wrap items-center gap-2">
          {badgeVariants.map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </div>
      </Block>

      <Block title="Avatar">
        <div className="flex items-center gap-3">
          <Avatar size="sm">
            <AvatarFallback>KK</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>KK</AvatarFallback>
          </Avatar>
          <Avatar size="lg">
            <AvatarFallback>KK</AvatarFallback>
          </Avatar>
        </div>
      </Block>

      <Block title="Tabs">
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">Overview</TabsTrigger>
            <TabsTrigger value="two">Models</TabsTrigger>
            <TabsTrigger value="three" disabled>
              Disabled
            </TabsTrigger>
          </TabsList>
          <TabsContent value="one" className="pt-3 text-muted-foreground">
            Overview content.
          </TabsContent>
          <TabsContent value="two" className="pt-3 text-muted-foreground">
            Models content.
          </TabsContent>
        </Tabs>
        <Tabs defaultValue="one">
          <TabsList variant="line">
            <TabsTrigger value="one">Line</TabsTrigger>
            <TabsTrigger value="two">Variant</TabsTrigger>
          </TabsList>
        </Tabs>
      </Block>

      <Block title="Separator, skeleton, scroll area">
        <Separator />
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-full" />
          <SkeletonText lines={2} className="flex-1" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="text-message">
            <SkeletonText lines={4} />
          </div>
          <p className="text-message">
            Skeleton lines are one line-height tall, so four of them take the
            height of four real lines.
          </p>
        </div>
        <ScrollArea className="h-28 rounded-xl border">
          <ul className="flex flex-col p-2">
            {Array.from({ length: 12 }, (_, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: static demo rows
                key={i}
                className="rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
              >
                Scrollable row {i + 1}
              </li>
            ))}
          </ul>
        </ScrollArea>
      </Block>

      <Block title="Provider and brand marks">
        <ul className="flex flex-wrap items-center gap-4">
          {providers.map((provider) => (
            <li
              key={provider}
              className="flex items-center gap-1.5 text-caption text-muted-foreground"
            >
              <ProviderIcon provider={provider} className="text-foreground" />
              {provider}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4">
          <GalaxyMark className="size-8" />
          <GitHubMark className="size-5" />
          <GoogleMark className="size-5" />
        </div>
      </Block>

      <Block title="Composer shell">
        <Composer
          chatId="showcase"
          onSend={async () => false}
          onStop={() => {}}
        />
      </Block>

      <Block title="Empty, error and inline states">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border py-8">
            <EmptyState
              headingLevel={2}
              icon={<MessageSquare />}
              title="No chats yet"
              description="Start a chat and it will show up here."
              action={<Button variant="outline">New chat</Button>}
            />
          </div>
          <div className="rounded-xl border py-8">
            <ErrorState
              headingLevel={2}
              description="Check your connection and try again."
              errorId="9f2c41ab"
              action={<Button variant="outline">Try again</Button>}
            />
          </div>
        </div>
        <EmptyState
          size="inline"
          title="No archived Chats"
          action={
            <Button size="sm" variant="ghost">
              New chat
            </Button>
          }
        />
        <ErrorState
          size="inline"
          title="Couldn't load usage"
          action={
            <Button size="sm" variant="ghost">
              Try again
            </Button>
          }
        />
        <InlineAlert
          action={<Button size="sm">Add your OpenRouter key</Button>}
        >
          You have no Credits left.
        </InlineAlert>
        <InlineAlert tone="warning">2 Credits left.</InlineAlert>
        <InlineAlert tone="info">Temporary chats aren't saved.</InlineAlert>
      </Block>
    </div>
  );
}
