import Image from "next/image";
import { cn } from "@/lib/utils";

const ARTWORK = {
  // Dark grey wordmark for light surfaces: the app shell and printed pages.
  black: { src: "/logo-black.png", width: 953, height: 506 },
  // White wordmark, only legible on navy, so it always brings its own panel.
  white: { src: "/logo-white.png", width: 1757, height: 933 },
} as const;

/** The company wordmark. */
export function Logo({
  variant = "black",
  className,
  imageClassName,
  priority,
}: {
  variant?: keyof typeof ARTWORK;
  className?: string;
  /** Sizes the wordmark; set a width and the height follows the artwork. */
  imageClassName?: string;
  priority?: boolean;
}) {
  const art = ARTWORK[variant];
  return (
    <div
      className={cn(
        "flex items-center",
        variant === "white" && "justify-center bg-[var(--logo-surface)]",
        className
      )}
    >
      <Image
        src={art.src}
        alt="D|R|P Dubai Rapid Properties"
        width={art.width}
        height={art.height}
        priority={priority}
        className={cn("h-auto", imageClassName)}
      />
    </div>
  );
}
