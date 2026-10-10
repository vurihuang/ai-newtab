/**
 * Injected after the bridge waits for page load and dynamic content. Read the
 * loaded DOM immediately: scrolling a long hidden tab with timers can take
 * minutes under Chromium's background timer throttling.
 */
export default defineContentScript({
  registration: "runtime",
  main() {
    return {
      url: location.href,
      title: document.title,
      html: document.body?.innerHTML ?? "",
    };
  },
});
