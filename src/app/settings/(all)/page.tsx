import { SettingsScreen } from "../_components/SettingsScreen";

// Every section on one page. The section rail links to the focused
// /settings/<section> routes, and each section also carries an id, so the
// fragment form (/settings#appearance) lands here and scrolls.
export default function SettingsPage() {
  return <SettingsScreen />;
}
