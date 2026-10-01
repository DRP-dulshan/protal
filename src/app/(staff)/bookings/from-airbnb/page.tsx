import { requireCapability } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/domain/shared";
import { env } from "@/lib/env";
import { AirbnbCapture } from "./capture";

export const metadata = { title: "From Airbnb" };

/**
 * The "Send to D|R|P" button opens this page with the reservation page's text
 * in the URL fragment (#...), which never reaches the server or its logs; the
 * page reads it in the browser and staff check it before anything is saved.
 */
export default async function FromAirbnbPage() {
  await requireCapability("bookings.manage");
  const supabase = await createClient();
  const { data: units } = await supabase
    .from("v_units_overview")
    .select("id, unit_number, property_name")
    .eq("is_active", true)
    .in("operating_mode", ["short_term", "both"])
    .order("property_name")
    .order("unit_number");

  const target = `${env.adminUrl}/bookings/from-airbnb`;
  // Runs on airbnb.com when clicked: opens this page in a new tab with the
  // page's text. No request to the portal is made from Airbnb's page.
  const bookmarklet =
    "javascript:(function(){var t=(document.body.innerText||'').slice(0,60000);" +
    `window.open(${JSON.stringify(target)}+'#'+encodeURIComponent(JSON.stringify({u:location.href,t:t})),'_blank','noopener');})();`;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Bookings", href: "/bookings" }]}
        title="From Airbnb"
        description="Adds a reservation's guest and price from its page on Airbnb."
      />
      <AirbnbCapture
        bookmarklet={bookmarklet}
        units={(units ?? []).map((u) => ({ id: u.id!, label: `${u.property_name} · ${u.unit_number}` }))}
      />
    </>
  );
}
