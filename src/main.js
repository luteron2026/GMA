import { Game } from './game.js';
import { hasProgress, storageAvailable } from './save.js';

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

  const showSaveInfo = () => {
    const s = game.save;
    const returning = hasProgress(s);
    $('play').textContent = returning ? 'CONTINUE' : 'PLAY';
    $('new-game').style.display = returning ? '' : 'none';
    if (returning) {
      const done = s.completed.length;
      const mins = Math.round(s.playTime / 60);
      $('save-summary').innerHTML = `<b>${s.credits.toLocaleString()}</b> Chapel Credits · <b>${done}/${game.missions.defs.length}</b> missions · <b>${s.deeds}</b> good deeds${mins ? ` · ${mins} min played` : ''}`;
    } else {
      $('save-summary').textContent = '';
    }
  };
  showSaveInfo();
  if (!storageAvailable()) {
    $('save-warning').textContent = 'Heads up: this browser is blocking saving (private browsing?), so progress will be lost when you close the page.';
  }

  const begin = () => {
    $('title').classList.remove('show');
    game.start();
    if (game.input.isTouch && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };
  $('play').addEventListener('click', begin);
  $('new-game').addEventListener('click', () => {
    if (!confirm('Start over? This erases your Chapel Credits and finished missions.')) return;
    game.resetProgress();
    showSaveInfo();
    begin();
  });
  $('resume').addEventListener('click', () => game.pause(false));
  $('btn-pause').addEventListener('click', () => game.pause(game.state === 'play'));
  $('btn-mute').addEventListener('click', () => {
    game.audio.unlock();
    const m = game.audio.toggleMute();
    $('btn-mute').textContent = m ? '🔇' : '🔊';
  });
  $('abandon').addEventListener('click', () => { game.missions.abandon(); game.pause(false); });
  $('reset-vehicles').addEventListener('click', () => { game.resetVehicles(); game.pause(false); });
  $('btn-vreset').addEventListener('click', () => game.resetVehicles());
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
  // Coming back via the browser's back/forward cache: refresh the title summary
  addEventListener('pageshow', (e) => { if (e.persisted && game.state === 'title') showSaveInfo(); });
}

$('play').disabled = true;
boot();
