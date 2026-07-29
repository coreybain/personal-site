import { redirect } from "next/navigation";

/** Horizon was promoted to the homepage — the archived URL forwards there. */
export default function HorizonRedirect() {
  redirect("/");
}
