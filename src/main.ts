import RAPIER from '@dimforge/rapier3d-compat';
import './core/device'; // sets the 'touch' class on <html> early
import { Game } from './game/Game';
import { loadProfile } from './game/profile';

async function main() {
  // Rapier is WebAssembly and must be loaded before any physics objects are created.
  await RAPIER.init();

  // Coins, best distance and your car are saved in the browser (localStorage).
  const profile = loadProfile();

  const container = document.getElementById('app')!;
  const game = new Game(container, profile);
  game.start(); // starts in the garage
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#fff;padding:20px">Failed to start: ${String(err)}</pre>`;
});
