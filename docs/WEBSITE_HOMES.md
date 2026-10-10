# Holiday Homes website integration

The portal is the source of truth for the homes on the Holiday Homes website.
Airbnb sync stays here (see CALENDAR_SYNC.md); the website reads from the portal
and pushes its own bookings back.

## Publishing a home
Unit page → **Website**. Fill in the title, area, type, photos and tick **Published**.
Nightly rate, max guests, cleaning fee, weekend rate and weekly/monthly discounts come from the unit itself.
The database refuses to publish a home that lacks what the website needs (`units_website_ready`).

## API (service-to-service)
| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/public/homes` | none | published, active homes |
| `GET /api/public/availability` | none | busy ranges per slug (bookings + Airbnb/Booking.com blocks) |
| `POST /api/public/bookings` | `Bearer WEBSITE_API_KEY` | website booking → `website_book_unit()` (409 if dates taken) |
| `PATCH /api/public/bookings/{ref}` | `Bearer WEBSITE_API_KEY` | `confirmed` or `cancelled` |

## Set up
1. Apply `supabase/migrations/0029_website_homes.sql` to Supabase.
2. Set `WEBSITE_API_KEY` (any long random string) on the portal; set the same value as `PORTAL_API_KEY` on the website, with `PORTAL_API_URL` = the portal's address.
