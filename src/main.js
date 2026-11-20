import { Game } from './game.js';

const $ = (id) => document.getElementById(id);

function boot() {
  let game;
  try {
    game = new Game($('game'));
  } catch (err) {
    console.error(err);
    $('loading').textContent = 'Sorry, your browser could not start WebGL. Try a recent Chrome, Safari, Edge, or Firefox.';
    $('play').style.display = 'none';
    return;
  }
  window.__game = game;
  $('loading').style.display = 'none';
  $('play').disabled = false;
  if (game.input.isTouch) {
    document.body.classList.add('touch');
    game.input.bindTouch($('touch'));
  }
  $('btn-mute').textContent = game.audio.muted ? '🔇' : '🔊';

  $('play').addEventListener('click', () => {
    $('title').classList.remove('show');
    game.start();
    if (game.input.isTouch && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });
  $('resume').addEventListener('click', () => game.pause(false));
  $('btn-pause').addEventListener('click', () => game.pause(game.state === 'play'));
  $('btn-mute').addEventListener('click', () => {
    game.audio.unlock();
    const m = game.audio.toggleMute();
    $('btn-mute').textContent = m ? '🔇' : '🔊';
  });
  $('abandon').addEventListener('click', () => { game.missions.abandon(); game.pause(false); });
  $('reset').addEventListener('click', () => {
    if (confirm('Reset all missions and Chapel Credits?')) { game.resetProgress(); game.pause(false); }
  });
  $('keep-playing').addEventListener('click', () => {
    $('ending').classList.remove('show');
    game.state = 'play';
    game.clock.getDelta();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'play') game.pause(true);
  });
}

$('play').disabled = true;
boot();
