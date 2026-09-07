import type { Metadata } from "next";

// One puzzle, one URL, one canonical.
//
// The corpus is a static asset fetched by the client, so this layout does not
// read it: doing so would pull the whole file into the server bundle to write a
// title. The id is enough to give the page a canonical of its own, which is the
// thing that was actually missing (several routes inherit the root canonical).
export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await props.params;
  const safe = encodeURIComponent(id);
  return {
    title: "A Nerf Chess puzzle: capture the king under a handicap",
    description:
      "One proven Nerf Chess puzzle. There is no checkmate in this game, so the answer ends with the king captured, and every alternative move was played out to prove the answer is the only one.",
    alternates: { canonical: `/puzzles/${safe}` },
    openGraph: { title: "A Nerf Chess puzzle", url: `/puzzles/${safe}` },
  };
}

export default function PuzzleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
