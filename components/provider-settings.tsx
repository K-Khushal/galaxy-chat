"use client";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BYOK_DISCLOSURE,
  type ByokProvider,
  type ByokView,
  type CredentialView,
  providers,
} from "@/lib/byok/contract";

export type ProviderSettingsClient = {
  load: () => Promise<ByokView>;
  save: (
    provider: ByokProvider,
    key: string,
    revision: string | null,
  ) => Promise<ByokView>;
  test: (provider: ByokProvider, revision: string) => Promise<ByokView>;
  delete: (provider: ByokProvider, revision: string) => Promise<ByokView>;
};
async function call(method: string, body?: object): Promise<ByokView> {
  const response = await fetch("/api/providers", {
    method,
    cache: "no-store",
    ...(body
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error?.id ?? "provider_settings_failed");
  window.dispatchEvent(new Event("provider-credentials-changed"));
  return value;
}
const realClient: ProviderSettingsClient = {
  load: () => call("GET"),
  save: (provider, key, revision) => call("PUT", { provider, key, revision }),
  test: (provider, revision) => call("POST", { provider, revision }),
  delete: (provider, revision) => call("DELETE", { provider, revision }),
};
const failureText: Record<string, string> = {
  byok_encryption_unavailable:
    "Secure key storage is unavailable. Please try again later.",
  byok_key_changed:
    "This key changed on another device. Reload keys before trying again.",
  byok_busy:
    "A request is active or awaiting recovery. Stop it or try again after it finishes.",
  byok_resource_limited:
    "The service request limit has been reached. Try again later.",
  byok_disabled: "Key testing is currently paused by the service.",
  invalid_provider_key: "Enter a key of 32–512 characters without spaces.",
};
export function ProviderSettings({
  client = realClient,
}: {
  client?: ProviderSettingsClient;
}) {
  const [view, setView] = useState<ByokView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [pending, setPending] = useState("");
  const guard = useRef(false);
  const [keys, setKeys] = useState<Partial<Record<ByokProvider, string>>>({});
  const [confirm, setConfirm] = useState<ByokProvider | null>(null);
  const [focusAfter, setFocusAfter] = useState<ByokProvider | null>(null);
  const deleteButtons = useRef<
    Partial<Record<ByokProvider, HTMLButtonElement | null>>
  >({});
  const keepButtons = useRef<
    Partial<Record<ByokProvider, HTMLButtonElement | null>>
  >({});
  useEffect(() => {
    if (confirm) keepButtons.current[confirm]?.focus();
  }, [confirm]);
  function cancelDelete(provider: ByokProvider) {
    setConfirm(null);
    deleteButtons.current[provider]?.focus();
  }
  const inputs = useRef<Partial<Record<ByokProvider, HTMLInputElement | null>>>(
    {},
  );
  useEffect(() => {
    if (focusAfter && !pending) {
      inputs.current[focusAfter]?.focus();
      setFocusAfter(null);
    }
  }, [focusAfter, pending]);
  useEffect(() => {
    let live = true;
    void client
      .load()
      .then((next) => {
        if (live) setView(next);
      })
      .catch(() => {
        if (live)
          setFailure(
            "Provider keys could not be loaded. Reload keys to try again.",
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [client]);
  async function act(
    action: string,
    run: () => Promise<ByokView>,
    onSuccess?: () => void,
  ) {
    if (guard.current) return;
    guard.current = true;
    setPending(action);
    setFailure("");
    try {
      setView(await run());
      onSuccess?.();
    } catch (error) {
      setFailure(
        failureText[error instanceof Error ? error.message : ""] ??
          "The key action could not be completed. Reload keys and try again.",
      );
    } finally {
      guard.current = false;
      setPending("");
    }
  }
  function status(key?: CredentialView) {
    if (!key) return "No saved key";
    return {
      untested: "Saved · not tested",
      valid: "Authentication checked · model access may vary",
      invalid: "Key rejected · replace or delete it",
      unavailable: "Test unavailable · try again later",
    }[key.testState];
  }
  return (
    <section aria-labelledby="provider-keys-heading" className="space-y-4">
      <div>
        <h2 id="provider-keys-heading" className="text-sm font-medium">
          Your provider keys
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {BYOK_DISCLOSURE}
        </p>
        <details className="mt-1 text-xs leading-relaxed text-muted-foreground">
          <summary className="min-h-11 cursor-pointer rounded-sm py-3 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Key safety and model limits
          </summary>
          <p>
            Encrypted on the server, synced across your signed-in devices. Tests
            verify authentication without inference. Reviewed text models only;
            no files, tools or search. Deleting a saved key prevents future
            requests. Stop any active response separately.
          </p>
          <p className="mt-2">
            Anonymous usage records remain after account deletion to enforce
            service limits. They contain no keys or conversation text.
          </p>
        </details>
      </div>
      {loading && (
        <output className="text-sm text-muted-foreground">
          Loading provider keys…
        </output>
      )}
      {view && !view.configured && (
        <p className="text-sm text-muted-foreground">
          BYOK generation and key testing are paused until the service is
          configured.
        </p>
      )}
      {view &&
        providers.map((provider) => {
          const saved = view.credentials.find((c) => c.provider === provider);
          const name = provider === "gateway" ? "Vercel Gateway" : "OpenRouter";
          const prefix = `provider-${provider}`;
          return (
            <section
              key={provider}
              aria-labelledby={`${prefix}-heading`}
              className="space-y-3 rounded-xl border p-4"
            >
              <div>
                <h3 id={`${prefix}-heading`} className="text-sm font-medium">
                  {name}
                </h3>
                {saved && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {saved.maskedKey}
                  </p>
                )}
                <output className="mt-1 block text-xs text-muted-foreground">
                  {status(saved)}
                </output>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const key = keys[provider] ?? "";
                  void act(
                    `${provider}-save`,
                    () => client.save(provider, key, saved?.revision ?? null),
                    () => {
                      setKeys((value) => ({ ...value, [provider]: "" }));
                    },
                  );
                }}
                className="space-y-2"
              >
                <label htmlFor={`${prefix}-key`} className="text-sm">
                  {saved ? "Replacement key" : "API key"}
                </label>
                <Input
                  ref={(element) => {
                    inputs.current[provider] = element;
                  }}
                  id={`${prefix}-key`}
                  name={`${provider}-key`}
                  type="password"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  minLength={32}
                  maxLength={512}
                  required
                  value={keys[provider] ?? ""}
                  disabled={Boolean(pending)}
                  onChange={(event) =>
                    setKeys((value) => ({
                      ...value,
                      [provider]: event.target.value,
                    }))
                  }
                  aria-describedby={`${prefix}-help`}
                />
                <p
                  id={`${prefix}-help`}
                  className="text-xs text-muted-foreground"
                >
                  {saved
                    ? "Replacing this key resets its test status. The saved key is never revealed."
                    : "Paste a provider API key. It is never included in account exports."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={Boolean(pending) || !keys[provider]?.length}
                    aria-busy={pending === `${provider}-save`}
                  >
                    {pending === `${provider}-save` && (
                      <Loader2 className="animate-spin" />
                    )}
                    {saved ? "Replace key" : "Save key"}
                  </Button>
                  {saved && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={Boolean(pending) || !view.configured}
                        aria-busy={pending === `${provider}-test`}
                        onClick={() =>
                          void act(`${provider}-test`, () =>
                            client.test(provider, saved.revision),
                          )
                        }
                      >
                        {pending === `${provider}-test` && (
                          <Loader2 className="animate-spin" />
                        )}
                        Test key
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={Boolean(pending)}
                        ref={(element) => {
                          deleteButtons.current[provider] = element;
                        }}
                        onClick={() => setConfirm(provider)}
                      >
                        Delete key
                      </Button>
                    </>
                  )}
                </div>
              </form>
              {saved && confirm === provider && (
                <div className="space-y-2 rounded-md border border-destructive/40 p-3">
                  <p className="text-sm">
                    Delete your saved {name} key? Future requests will require a
                    new key.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={Boolean(pending)}
                      ref={(element) => {
                        keepButtons.current[provider] = element;
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && !pending) {
                          event.preventDefault();
                          event.stopPropagation();
                          cancelDelete(provider);
                        }
                      }}
                      onClick={() => cancelDelete(provider)}
                    >
                      Keep key
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={Boolean(pending)}
                      aria-busy={pending === `${provider}-delete`}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && !pending) {
                          event.preventDefault();
                          event.stopPropagation();
                          cancelDelete(provider);
                        }
                      }}
                      onClick={() =>
                        void act(
                          `${provider}-delete`,
                          () => client.delete(provider, saved.revision),
                          () => {
                            setConfirm(null);
                            setFocusAfter(provider);
                          },
                        )
                      }
                    >
                      {pending === `${provider}-delete` && (
                        <Loader2 className="animate-spin" />
                      )}
                      Delete saved key
                    </Button>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        disabled={Boolean(pending) || loading}
        aria-busy={pending === "reload"}
        onClick={() => void act("reload", client.load)}
      >
        {pending === "reload" && <Loader2 className="animate-spin" />}Reload
        keys
      </Button>
    </section>
  );
}
