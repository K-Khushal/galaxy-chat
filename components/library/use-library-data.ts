"use client";

import { useEffect, useState } from "react";

export interface MediaMessage {
  id: string;
  chatId: string;
  messageId: string;
  imageUrl: string;
  createdAt: Date;
  chatTitle?: string;
}

export function useLibraryData() {
  const [mediaMessages, setMediaMessages] = useState<MediaMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMediaMessages = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch("/api/library");

        if (!response.ok) {
          throw new Error(`Failed to fetch media: ${response.statusText}`);
        }

        const data = await response.json();
        // Convert createdAt strings to Date objects
        const mediaMessages = (data.mediaMessages || []).map((msg: any) => ({
          ...msg,
          createdAt: new Date(msg.createdAt),
        }));
        setMediaMessages(mediaMessages);
      } catch (err) {
        console.error("Error fetching media messages:", err);
        setError(err instanceof Error ? err.message : "Failed to load media");
      } finally {
        setIsLoading(false);
      }
    };

    fetchMediaMessages();
  }, []);

  return {
    mediaMessages,
    isLoading,
    error,
    refetch: () => {
      setIsLoading(true);
      setError(null);
      // Re-trigger the effect
      setMediaMessages([]);
    },
  };
}
