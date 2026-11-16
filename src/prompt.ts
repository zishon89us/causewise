// Prompts live in prompts/<name>/ with a version (AGENTS.md); application
// code loads them by name and never inlines prompt text.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface Prompt {
  name: string;
  version: string;
  text: string;
}

export function loadPrompt(name: string, version?: string): Prompt {
  const dir = new URL(`../prompts/${name}/`, import.meta.url);
  const meta = JSON.parse(readFileSync(fileURLToPath(new URL('meta.json', dir)), 'utf8')) as { current: string };
  const v = version ?? meta.current;
  return { name, version: v, text: readFileSync(fileURLToPath(new URL(`${v}.md`, dir)), 'utf8').trim() };
}
