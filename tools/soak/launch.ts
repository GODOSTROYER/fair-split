/** Run the dist soak with the same V8 limits as Render; accept no shell or arbitrary Node options. */
export function apiStartArgs(command: string): string[] {
  if (
    !/^node(?:\s+--(?:max-old-space-size|max-semi-space-size)=\d+)*\s+apps\/api\/dist\/index\.js$/.test(
      command.trim(),
    )
  ) {
    throw new Error("Unsupported fs-api start command for the dist soak");
  }
  return command.trim().split(/\s+/).slice(1);
}
