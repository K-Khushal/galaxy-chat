import type { GeneratedFile } from "ai";
import NextImage from "next/image";
import { cn } from "@/lib/utils";

export type ImageProps = GeneratedFile & {
  className?: string;
  alt?: string;
};

export const Image = ({
  base64,
  mediaType,
  alt = "Generated output",
  className,
}: ImageProps) => (
  <NextImage
    alt={alt}
    className={cn("h-auto max-w-full overflow-hidden rounded-md", className)}
    height={512}
    src={`data:${mediaType};base64,${base64}`}
    unoptimized
    width={512}
  />
);
