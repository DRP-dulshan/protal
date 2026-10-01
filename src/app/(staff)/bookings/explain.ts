/**
 * Turns the database's guard rails into sentences. The permit gate and the
 * no-overlap constraint live in SQL (0005) so nothing can bypass them; this
 * only explains a refusal.
 */
export function explain(error: { code?: string; message: string }): string {
  if (error.message.includes("no valid DET holiday home permit")) {
    return "This unit has no valid DET permit covering the check-in date. Add or renew the permit on the unit's DET permits tab first.";
  }
  if (error.code === "23P01" || error.message.includes("bookings_no_overlap")) {
    return "These dates overlap another booking for this unit.";
  }
  if (error.code === "42501" || error.message.includes("row-level security")) {
    return "You do not have access to this unit. Ask a super admin to assign it to you.";
  }
  if (error.code === "23505" && error.message.includes("hh_permits_number")) {
    return "That permit number is already recorded as active or pending.";
  }
  return error.message;
}
