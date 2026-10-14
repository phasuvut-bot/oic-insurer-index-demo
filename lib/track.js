// Visitor counting for the public demo only. scripts/build-pages.mjs adds the GoatCounter script (cookie-free,
// no personal data) to the GitHub Pages copy; everywhere else window.goatcounter is missing and these are no-ops.
// Page paths include the hash route, e.g. /#/product/banyan-smart.

const gc = () => (window.goatcounter && typeof window.goatcounter.count === 'function' ? window.goatcounter : null);

/** Count a page view of the current hash route (the first view is counted by the script itself on load). */
export function trackView() {
  gc()?.count();
}

/** Count a "tried the demo" action, e.g. track('review-submitted'). Never pass anything a visitor typed. */
export function track(event) {
  gc()?.count({ path: event, title: event, event: true });
}
