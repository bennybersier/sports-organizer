import { notFound } from "next/navigation";

/**
 * Any address below a team's page that is not a page — a mistyped match link,
 * say. Without this it falls through to the app's 404, whose way out is the
 * dashboard; here it reaches the team's not-found, which leads back to the team.
 */
export default function UnknownTeamPage() {
  notFound();
}
