import { file, write } from "bun";

export function readFile(path: string) {
  return file(path);
}

export function writeFile(path: string, data: Uint8Array) {
  return write(path, data);
}
