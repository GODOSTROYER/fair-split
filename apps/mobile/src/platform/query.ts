/** Native has no URL query; stage frames and demo links only exist on the web export. */
export function webQuery(_name: string): string | null {
  return null;
}
