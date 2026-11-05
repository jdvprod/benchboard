/** Line icons for navigation (drawn here so the app has no icon dependency). */
const P: Record<string, string> = {
  track: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18M12 4v16"/>',
  lineup: '<circle cx="7" cy="8" r="2"/><circle cx="17" cy="8" r="2"/><circle cx="12" cy="16" r="2"/><path d="M3 3h18v18H3z"/>',
  practice: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2.5v3M16 2.5v3M4 9h16M8 13h5M8 17h8"/>',
  formations: '<rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 9h18"/><circle cx="7.5" cy="13" r="1.6"/><circle cx="16.5" cy="13" r="1.6"/><circle cx="12" cy="17.5" r="1.6"/><path d="M9 13.5l2 3" stroke-dasharray="1.5 1.5"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/><path d="M10.5 10l3.5 2-3.5 2z"/>',
  labs: '<path d="M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7.5 15h9"/>',
  matchup: '<path d="M4 4l6 6M4 10l6-6"/><circle cx="17" cy="7" r="3"/><path d="M3 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M14.5 15.5c.8-.3 1.6-.5 2.5-.5 3 0 4.5 2 4.5 5"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  court: '<rect x="5" y="2.5" width="14" height="19" rx="1"/><path d="M3 12h18M5 8.5h14M5 15.5h14"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.3"/><path d="M16 14.2c2.9.3 5 2.7 5 5.8"/>',
  live: '<circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.2-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.8 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 20.9 10H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  brand: '<path d="M5 19V11M10 19V6M15 19v-6"/><circle cx="18.5" cy="6.5" r="2.5"/>',
};
export function Icon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: P[name] || "" }} />;
}
export const Ball = () => (
  <svg className="ball" viewBox="0 0 16 16" aria-label="serving"><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 1.6c-1.2 2.6-1 5.4 0 6.4s3.8 1.6 6.3.4M8 8c-1.3 1-4 1.7-6.2.6M8 8c.4 1.6 2 4.1 4.3 5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
);
