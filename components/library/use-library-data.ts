"use client";

import { useCallback, useEffect, useState } from "react";

export interface MediaMessage {
  id: string;
  chatId: string;
  messageId: string;
  imageUrl: string;
  createdAt: string | Date;
  chatTitle?: string;
}

export function useLibraryData() {
  const [mediaMessages, setMediaMessages] = useState<MediaMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMediaMessages = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch("/api/library");

      if (!response.ok) {
        throw new Error(`Failed to fetch media: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        mediaMessages?: Array<{ createdAt: string; [key: string]: unknown }>;
      };
      // Convert createdAt strings to Date objects
      const mediaMessages: MediaMessage[] = (data.mediaMessages || []).map(
        (msg) =>
          ({
            ...msg,
            createdAt: new Date(msg.createdAt),
          }) as MediaMessage,
      );
      setMediaMessages(mediaMessages);
    } catch (err) {
      console.error("Error fetching media messages:", err);
      setError(err instanceof Error ? err.message : "Failed to load media");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMediaMessages();
  }, [fetchMediaMessages]);

  return {
    mediaMessages,
    isLoading,
    error,
    refetch: fetchMediaMessages,
  };
}
