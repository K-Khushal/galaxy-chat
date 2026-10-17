"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/elements/conversation";
import { Message, MessageContent } from "@/components/elements/message";
import { Response } from "@/components/elements/response";
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  SegmentedControl,
  Stack,
  setKitMotion,
  TextArea,
  ThemeProvider,
  tokens,
  usePal,
} from "@/vendor/halaska/halaska-kit";

const LOCAL_REPLY =
  "Local compatibility reply. No provider was called. Text is appended in place so the message does not jump between loading and completion.";

const THEME_OPTIONS = ["light", "dark"];

type ThemeName = "light" | "dark";

type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type ReplyStatus = "Idle" | "Responding" | "Stopped" | "Complete";

function isThemeName(value: string): value is ThemeName {
  return value === "light" || value === "dark";
}

function TurnBody({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    return <span>{turn.text}</span>;
  }
  if (turn.text.length === 0) {
    return <span>Responding</span>;
  }
  return <Response>{turn.text}</Response>;
}

function PrototypeFrame({
  onTheme,
  theme,
}: {
  onTheme: (value: string) => void;
  theme: ThemeName;
}) {
  const pal = usePal(theme);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<ReplyStatus>("Idle");
  const [notesOpen, setNotesOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const idRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setReducedMotion(media.matches);
      setKitMotion(media.matches ? "instant" : "spring");
    };
    apply();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const stop = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setStreaming(false);
    setStatus("Stopped");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || streaming) {
      return;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    idRef.current += 1;
    const userId = `turn-${idRef.current}`;
    idRef.current += 1;
    const assistantId = `turn-${idRef.current}`;
    setDraft("");
    setMessages((current) => [
      ...current,
      { id: userId, role: "user", text },
      { id: assistantId, role: "assistant", text: "" },
    ]);
    setStreaming(true);
    setStatus("Responding");

    if (reducedMotion) {
      setMessages((current) =>
        current.map((turn) =>
          turn.id === assistantId ? { ...turn, text: LOCAL_REPLY } : turn,
        ),
      );
      setStreaming(false);
      setStatus("Complete");
      return;
    }

    let written = 0;
    intervalRef.current = setInterval(() => {
      written += 12;
      const nextText = LOCAL_REPLY.slice(0, written);
      setMessages((current) =>
        current.map((turn) =>
          turn.id === assistantId ? { ...turn, text: nextText } : turn,
        ),
      );
      if (written < LOCAL_REPLY.length) {
        return;
      }
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setStreaming(false);
      setStatus("Complete");
    }, 32);
  };

  return (
    <main
      style={{
        background: pal.bg,
        color: pal.text,
        fontFamily: tokens.font.sans,
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <div style={{ margin: "0 auto", maxWidth: 720 }}>
        <Stack gap={16}>
          <header>
            <h1
              style={{
                color: pal.text,
                fontFamily: tokens.font.sans,
                fontSize: 28,
                lineHeight: 1.2,
                margin: 0,
              }}
            >
              F01 compatibility prototype
            </h1>
            <p style={{ color: pal.textSecondary, marginBottom: 0 }}>
              Local Halaska shell around the existing AI Elements conversation.
              Sending a message does not call a model provider.
            </p>
          </header>
          <Stack
            align="center"
            direction="row"
            gap={12}
            justify="space-between"
          >
            <Stack gap={4}>
              <span style={{ color: pal.textSecondary, fontSize: 12 }}>
                Theme
              </span>
              <SegmentedControl
                onChange={onTheme}
                options={THEME_OPTIONS}
                theme={theme}
                value={theme}
              />
            </Stack>
            <Button
              onClick={() => setNotesOpen(true)}
              theme={theme}
              type="button"
              variant="secondary"
            >
              Spike notes
            </Button>
          </Stack>
          <Card theme={theme}>
            <CardHeader
              subtitle="Canned local text, not a live model"
              theme={theme}
              title="Conversation"
            />
            <div className="flex h-96 min-h-0 flex-col">
              <Conversation aria-busy={streaming} className="min-h-0 flex-1">
                <ConversationContent>
                  {messages.length === 0 ? (
                    <EmptyState
                      description="The composer below uses Halaska. Messages use the existing AI Elements transcript."
                      theme={theme}
                      title="No messages yet"
                    />
                  ) : (
                    messages.map((turn) => (
                      <Message from={turn.role} key={turn.id}>
                        <MessageContent>
                          <TurnBody turn={turn} />
                        </MessageContent>
                      </Message>
                    ))
                  )}
                </ConversationContent>
                <ConversationScrollButton aria-label="Scroll to latest message" />
              </Conversation>
            </div>
            <form onSubmit={submit}>
              <Stack gap={12}>
                <TextArea
                  caption="Send submits the message. This kit field does not expose a key handler, so Enter inserts a new line."
                  label="Message"
                  onChange={setDraft}
                  placeholder="Write a message"
                  rows={3}
                  theme={theme}
                  value={draft}
                />
                <Stack direction="row" gap={8}>
                  <Button
                    disabled={streaming || draft.trim().length === 0}
                    theme={theme}
                    type="submit"
                  >
                    Send
                  </Button>
                  <Button
                    disabled={!streaming}
                    onClick={stop}
                    theme={theme}
                    type="button"
                    variant="secondary"
                  >
                    Stop
                  </Button>
                </Stack>
              </Stack>
            </form>
          </Card>
          <output aria-live="polite" id="f01-status">
            {status}
          </output>
        </Stack>
      </div>
      <Dialog
        onClose={() => setNotesOpen(false)}
        open={notesOpen}
        theme={theme}
        title="Spike notes"
      >
        This screen is a local compatibility prototype. It does not deploy,
        authenticate, or stream from a provider. Theme options are a kit radio
        group. Escape closes this dialog. Reduced motion reveals the canned
        reply at once and switches the kit motion preset to instant.
      </Dialog>
    </main>
  );
}

export function HalaskaElementsPrototype() {
  const [theme, setTheme] = useState<ThemeName>("light");

  return (
    <ThemeProvider theme={theme}>
      <PrototypeFrame
        onTheme={(value) => {
          if (isThemeName(value)) {
            setTheme(value);
          }
        }}
        theme={theme}
      />
    </ThemeProvider>
  );
}
