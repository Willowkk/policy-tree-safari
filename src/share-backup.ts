/** A cancelled share stays cancelled; an unavailable share falls back to download. */
export async function shareOrDownloadBackup(
  share: (() => Promise<void>) | undefined,
  download: () => void,
): Promise<"shared" | "cancelled" | "downloaded"> {
  if (share) {
    try {
      await share();
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
      // Embedded browsers can advertise file sharing but deny the actual request.
    }
  }
  download();
  return "downloaded";
}
