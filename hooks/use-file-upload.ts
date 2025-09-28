import { useCallback, useState } from "react";

// Constants
const UPLOAD_TIMEOUT = 30000; // 30 seconds

/**
 * Represents the progress of a file upload
 */
export interface UploadProgress {
  fileId: string;
  progress: number;
  status: "uploading" | "completed" | "error";
  error?: string;
  url?: string;
}

/**
 * Represents the result of a successful file upload
 */
export interface UploadResult {
  success: boolean;
  url: string;
  service: "cloudinary";
  fileId: string;
  publicId?: string;
}

/**
 * Represents the result of a successful file deletion
 */
export interface DeleteResult {
  success: boolean;
  message: string;
  publicId: string;
}

/**
 * Options for the useFileUpload hook
 */
export interface UseFileUploadOptions {
  service?: "cloudinary";
  onProgress?: (progress: UploadProgress) => void;
  onComplete?: (result: UploadResult) => void;
  onError?: (error: { fileId: string; error: string }) => void;
  onDeleteComplete?: (result: DeleteResult) => void;
  onDeleteError?: (error: { publicId: string; error: string }) => void;
}

/**
 * Custom hook for handling file uploads with progress tracking
 * Supports Cloudinary service
 *
 * @param options - Configuration options for the upload hook
 * @returns Object containing upload functions and state
 */
export const useFileUpload = (options: UseFileUploadOptions = {}) => {
  const [uploads, setUploads] = useState<Map<string, UploadProgress>>(
    new Map(),
  );
  const [isUploading, setIsUploading] = useState(false);

  const uploadFile = useCallback(
    async (file: File, fileId: string): Promise<UploadResult | null> => {
      const { onProgress, onComplete, onError } = options;

      // Initialize upload progress
      const initialProgress: UploadProgress = {
        fileId,
        progress: 0,
        status: "uploading",
      };

      setUploads((prev) => new Map(prev.set(fileId, initialProgress)));
      setIsUploading(true);

      try {
        const formData = new FormData();
        formData.append("file", file);

        // Create XMLHttpRequest for progress tracking
        const xhr = new XMLHttpRequest();

        // Track upload progress
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const progress = Math.round((event.loaded / event.total) * 100);
            const progressUpdate: UploadProgress = {
              fileId,
              progress,
              status: "uploading",
            };

            setUploads((prev) => new Map(prev.set(fileId, progressUpdate)));
            onProgress?.(progressUpdate);
          }
        });

        // Handle completion
        const uploadPromise = new Promise<UploadResult>((resolve, reject) => {
          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const result: UploadResult = JSON.parse(xhr.responseText);

                // Validate the response
                if (!result.success || !result.url) {
                  reject(new Error("Invalid upload response"));
                  return;
                }

                const completedProgress: UploadProgress = {
                  fileId,
                  progress: 100,
                  status: "completed",
                  url: result.url,
                };

                setUploads(
                  (prev) => new Map(prev.set(fileId, completedProgress)),
                );
                onComplete?.({ ...result, fileId });
                resolve(result);
              } catch {
                reject(new Error("Failed to parse response"));
              }
            } else {
              try {
                const errorResponse = JSON.parse(xhr.responseText);
                reject(
                  new Error(
                    errorResponse.error ||
                      `Upload failed with status ${xhr.status}`,
                  ),
                );
              } catch {
                reject(new Error(`Upload failed with status ${xhr.status}`));
              }
            }
          });

          xhr.addEventListener("error", () => {
            reject(new Error("Network error"));
          });

          xhr.addEventListener("timeout", () => {
            reject(new Error("Upload timeout"));
          });
        });

        // Start upload
        xhr.open("POST", "/api/upload");
        xhr.timeout = UPLOAD_TIMEOUT;
        xhr.send(formData);

        const result = await uploadPromise;
        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Upload failed";
        const errorProgress: UploadProgress = {
          fileId,
          progress: 0,
          status: "error",
          error: errorMessage,
        };

        setUploads((prev) => new Map(prev.set(fileId, errorProgress)));
        onError?.({ fileId, error: errorMessage });
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [options],
  );

  const uploadFiles = useCallback(
    async (
      files: File[],
      customFileIds?: string[],
    ): Promise<UploadResult[]> => {
      const uploadPromises = files.map((file, index) => {
        const fileId =
          customFileIds?.[index] || `${file.name}-${index}-${Date.now()}`;
        return uploadFile(file, fileId);
      });

      const results = await Promise.all(uploadPromises);
      return results.filter(
        (result): result is UploadResult => result !== null,
      );
    },
    [uploadFile],
  );

  const getUploadProgress = useCallback(
    (fileId: string): UploadProgress | undefined => {
      return uploads.get(fileId);
    },
    [uploads],
  );

  const deleteFile = useCallback(
    async (publicId: string): Promise<DeleteResult | null> => {
      const { onDeleteComplete, onDeleteError } = options;

      try {
        const response = await fetch("/api/upload", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ publicId }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Delete failed");
        }

        const result: DeleteResult = await response.json();

        if (!result.success) {
          throw new Error("Delete failed: Invalid response");
        }

        onDeleteComplete?.(result);
        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Delete failed";

        onDeleteError?.({ publicId, error: errorMessage });
        return null;
      }
    },
    [options],
  );

  return {
    uploadFile,
    uploadFiles,
    deleteFile,
    getUploadProgress,
    isUploading,
    uploads: Array.from(uploads.values()),
  };
};
