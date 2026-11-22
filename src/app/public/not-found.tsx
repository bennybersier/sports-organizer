import { PublicNotFound } from "./public-not-found";

/** Anything else under /public: the parents' 404, not the app's. */
export default function PublicSectionNotFound() {
  return <PublicNotFound />;
}
