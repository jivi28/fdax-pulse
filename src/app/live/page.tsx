import { redirect } from "next/navigation";

// Live paper trading now runs on the home page against a real public futures
// feed, so the former "locked" placeholder simply forwards there.
export default function LiveRedirectPage() {
  redirect("/");
}
