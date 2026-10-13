import type { BookingStatus } from "@/lib/types";

// Shared PostgREST select + row shape for every admin bookings list (Inicio,
// Turnos, the client page). Kept in a PLAIN module (not the "use client"
// admin-bookings.tsx) so server pages import the real string — a value exported
// from a "use client" module reaches a server component as a client-reference
// proxy, not the string.
// The `profiles!user_id` embed disambiguates bookings' two FKs to profiles.
export const BOOKINGS_SELECT =
  "id, starts_at, status, service_id, user_id, services(name, price_ars), profiles!user_id(full_name, whatsapp_phone, email)";

// Same rows, but only bookings whose client matches a filter on `profiles`
// (an inner join; the plain embed would keep the booking and null the client).
export const BOOKINGS_SELECT_BY_CLIENT = BOOKINGS_SELECT.replace(
  "profiles!user_id(",
  "profiles!user_id!inner(",
);

export type AdminBookingRow = {
  id: string;
  startsAt: string;
  status: BookingStatus;
  serviceId: string;
  userId: string;
  service: string;
  price: number | null;
  client: string;
  phone: string | null;
  email: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapBooking(b: any): AdminBookingRow {
  return {
    id: b.id as string,
    startsAt: b.starts_at as string,
    status: b.status as BookingStatus,
    serviceId: b.service_id as string,
    userId: b.user_id as string,
    service: b.services?.name ?? "Servicio",
    price: (b.services?.price_ars as number) ?? null,
    client: b.profiles?.full_name ?? "—",
    phone: (b.profiles?.whatsapp_phone as string) ?? null,
    email: (b.profiles?.email as string) ?? null,
  };
}
