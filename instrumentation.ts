export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPolling } = await import("./lib/tracker");
    startPolling();
  }
}
