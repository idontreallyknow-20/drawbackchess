// Route skeleton for /codex/boon/[id]: the shared card-page geometry, so this
// route no longer inherits the library grid from /codex/loading.tsx.

import { CardPageSkeleton } from "@/app/codex/_components/CardPageSkeleton";

export default function Loading() {
  return <CardPageSkeleton />;
}
