export function getVideoAspectRatio(filePath: string) {
  // const file = Bun.file()
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    {
      cwd: "../samples/",
      // stdout: "pipe",
      stderr: "pipe",
    },
  );

  // const stdout,
}
