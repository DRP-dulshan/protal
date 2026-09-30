import type { TicketNote } from "@/components/domain/ticket-notes";
import { MAINTENANCE_STATUS } from "@/lib/labels";
import type { Enums } from "@/lib/db/database.types";

const when = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Dubai",
});

type Status = Enums<"maintenance_status">;

export interface NoteRow {
  id: string;
  author_id: string | null;
  note: string | null;
  status_from: Status | null;
  status_to: Status | null;
  is_internal: boolean;
  created_at: string;
}

/**
 * Timeline entries for display. `authorName` decides how people are shown:
 * staff see names, owners see "You" and "D|R|P".
 */
export function toTicketNotes(rows: NoteRow[], authorName: (id: string | null) => string): TicketNote[] {
  return rows.map((r) => ({
    id: r.id,
    author: authorName(r.author_id),
    when: when.format(new Date(r.created_at)),
    note: r.note,
    change:
      r.status_to && r.status_from !== r.status_to
        ? `${r.status_from ? MAINTENANCE_STATUS[r.status_from] : "New"} → ${MAINTENANCE_STATUS[r.status_to]}`
        : null,
    internal: r.is_internal,
  }));
}
