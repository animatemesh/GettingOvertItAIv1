/**
 * main.ts - bootstrap entry for "Climb of Patience".
 */
import './style.css';
import { Game } from './Game';
import { MapEditor } from './editor/MapEditor';

const REDIRECT_STORAGE_KEY = 'climb-of-patience:redirect-path';
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container');

const redirectPath = window.sessionStorage.getItem(REDIRECT_STORAGE_KEY);
if (redirectPath) {
  window.sessionStorage.removeItem(REDIRECT_STORAGE_KEY);
  window.history.replaceState(null, '', redirectPath);
}

const routePath = normalizePath(window.location.pathname);
if (routePath === '/editor' || routePath.endsWith('/editor')) {
  document.title = 'Climb of Patience Editor';
  new MapEditor(app);
} else {
  const game = new Game(app);
  game.start().catch((err) => {
    console.error('Failed to start game:', err);
    const msg = document.createElement('pre');
    msg.className = 'fatal';
    msg.textContent = `Failed to start:\n${err?.stack ?? err}`;
    app.appendChild(msg);
  });
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed || '/';
}
