import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The company wordmark. The artwork is white on transparent, so it always
 * sits on its own navy panel: that keeps it legible on the light app
 * background and unchanged if a dark theme is ever switched on.
 */
export function Logo({
  className,
  imageClassName,
  priority,
}: {
  className?: string;
  /** Sizes the wordmark; set a width and the height follows the artwork. */
  imageClassName?: string;
  priority?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-center bg-[var(--logo-surface)]", className)}>
      <Image
        src="/logo-white.png"
        alt="D|R|P Dubai Rapid Properties"
        width={1757}
        height={933}
        priority={priority}
        className={cn("h-auto", imageClassName)}
      />
    </div>
  );
}
