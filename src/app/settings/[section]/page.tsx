import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SECTIONS } from "@/components/settings/config";
import { SettingsScreen } from "../_components/SettingsScreen";

// One section, at its own address. This is a server component on purpose: the
// section name has to be validated before the response streams for an unknown
// one to carry a real 404 status rather than a 200 with a sorry page in it, and
// only the server can put the section's own title in <head>.
//
// The section list is the same SECTIONS array the panel renders, so a new
// section is routable the moment it is added to the config — including its
// static params and its metadata.

export function generateStaticParams() {
  return SECTIONS.map((s) => ({ section: s.id }));
}

export async function generateMetadata(props: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const { section } = await props.params;
  const found = SECTIONS.find((s) => s.id === section);
  if (!found) return { title: "Settings" };
  return {
    title: `${found.title} settings`,
    description: found.blurb,
    robots: { index: false, follow: true },
    alternates: { canonical: `/settings/${found.id}` },
  };
}

export default async function SettingsSectionPage(props: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await props.params;
  // Renders ./not-found.tsx, which names the sections that do exist.
  if (!SECTIONS.some((s) => s.id === section)) notFound();
  return <SettingsScreen focus={section} />;
}
