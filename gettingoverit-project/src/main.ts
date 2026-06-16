/**
 * main.ts — bootstrap entry for "Climb of Patience".
 */
import './style.css';
import { Game } from './Game';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container');

const game = new Game(app);
game.start().catch((err) => {
  console.error('Failed to start game:', err);
  const msg = document.createElement('pre');
  msg.className = 'fatal';
  msg.textContent = `Failed to start:\n${err?.stack ?? err}`;
  app.appendChild(msg);
});
