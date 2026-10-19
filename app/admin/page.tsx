import { redirect } from "next/navigation";

// The panel has no home screen: /admin is the agenda. Push payloads and the
// "Abrir panel" email button still point here, and land in the right place.
export default function AdminPage() {
  redirect("/admin/agenda");
}
