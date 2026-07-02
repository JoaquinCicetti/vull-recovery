// Shared PostgREST select for the admin bookings list. Kept in a PLAIN module
// (not the "use client" admin-bookings.tsx) so the server page and the client
// "load more" both import the real string — a value exported from a "use client"
// module reaches a server component as a client-reference proxy, not the string.
// The `profiles!user_id` embed disambiguates bookings' two FKs to profiles.
export const BOOKINGS_SELECT =
  "id, starts_at, status, service_id, services(name, price_ars), profiles!user_id(full_name, whatsapp_phone, email)";
