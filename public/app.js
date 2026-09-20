const body = document.getElementById('standingsBody');
const emptyState = document.getElementById('emptyState');
const refreshBtn = document.getElementById('refreshBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function pad2(num) {
  const n = Number(num);
  if (Number.isNaN(n)) return '00';
  return n < 10 && n >= 0 ? `0${n}` : `${n}`;
}

function render(data) {
  const teams = data.teams || [];
  const tournament = data.tournament || {};

  const titleText = tournament.title || 'FREE FIRE CHAMPIONSHIP';
  const subText = tournament.subtitle || 'SEMI FINAL GROUP A';
  const status = tournament.status || 'LIVE';

  if (document.getElementById('crestTitle')) {
    document.getElementById('crestTitle').textContent = titleText.length > 20 ? 'CHAMPIONSHIP' : titleText;
  }
  if (document.getElementById('topbarTitle')) {
    document.getElementById('topbarTitle').textContent = titleText;
  }
  if (document.getElementById('tournamentSubtitle')) {
    document.getElementById('tournamentSubtitle').textContent = subText;
  }
  if (document.getElementById('statusText')) {
    document.getElementById('statusText').textContent = status;
  }

  if (!teams || teams.length === 0) {
    body.innerHTML = '';
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  body.innerHTML = teams.map(team => {
    const rank = Number(team.rank || 1);
    const b = Number(team.b || 0);
    const kp = Number(team.kp || 0);
    const pp = Number(team.pp || 0);
    const total = Number(team.totalPoints ?? team.points ?? (b + pp + kp));

    const booyahText = b > 0 ? pad2(b) : '';

    return `
      <div class="leaderboard-row ${rank <= 3 ? 'top-team-row rank-' + rank : ''}" data-rank="${rank}">
        <div class="cell-box col-no">${pad2(rank)}</div>
        <div class="slash-separator" aria-hidden="true"></div>
        <div class="cell-box col-name">${escapeHtml(team.name)}</div>
        <div class="slash-separator" aria-hidden="true"></div>
        <div class="cell-box col-booyah">${booyahText}</div>
        <div class="slash-separator" aria-hidden="true"></div>
        <div class="cell-box col-kills">${pad2(kp)}</div>
        <div class="slash-separator" aria-hidden="true"></div>
        <div class="cell-box col-points">${pad2(pp)}</div>
        <div class="slash-separator" aria-hidden="true"></div>
        <div class="cell-box col-total">${pad2(total)}</div>
      </div>
    `;
  }).join('');
}

async function loadStandings(showError = true) {
  try {
    const response = await fetch('/api/standings', { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load standings');
    render(await response.json());
  } catch (error) {
    if (showError && body) {
      body.innerHTML = '<div style="text-align:center;color:#fff;background:rgba(200,40,0,0.8);padding:24px;border-radius:4px;font-weight:700">Unable to load live tournament scores. Check server connection.</div>';
    }
  }
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', () => loadStandings(false));
}

if (fullscreenBtn) {
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      fullscreenBtn.textContent = '⛶ EXIT FULL';
    } else {
      document.exitFullscreen().catch(() => {});
      fullscreenBtn.textContent = '⛶ FULLSCREEN';
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      fullscreenBtn.textContent = '⛶ FULLSCREEN';
    }
  });
}

loadStandings();
setInterval(() => loadStandings(false), 4000);
