import { notFound } from "next/navigation";

/** Any other address under /public: the parents' 404 rather than the app's. */
export default function UnknownPublicPage() {
  notFound();
}
