const loginView = document.getElementById('loginView');
const dashboardView = document.getElementById('dashboardView');
const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');
const adminBody = document.getElementById('adminBody');
const adminEmpty = document.getElementById('adminEmpty');
const modalBackdrop = document.getElementById('modalBackdrop');
const teamForm = document.getElementById('teamForm');
const modalMessage = document.getElementById('modalMessage');
const teamMessage = document.getElementById('teamMessage');
let currentData = null;
let csrfToken = null;

// Placement points table (mirrors server.js)
const PLACEMENT_POINTS = { 1: 10, 2: 7, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 0 };

function placementToPoints(position) {
  const pos = Math.max(1, Math.min(8, parseInt(position, 10) || 8));
  return PLACEMENT_POINTS[pos] ?? 0;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

async function api(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (csrfToken && options.method && options.method !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken;
  }
  const opts = { ...options, headers };
  const response = await fetch(url, opts);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function setLoggedIn(loggedIn) {
  loginView.hidden = loggedIn;
  dashboardView.hidden = !loggedIn;
  document.getElementById('logoutBtn').style.display = loggedIn ? 'inline-block' : 'none';
}

// Update modal preview: ST pts from position, total = ST + KP (booyah excluded)
function updateModalTotal() {
  const position = parseInt(document.getElementById('teamPosition')?.value, 10) || 8;
  const kp = Math.max(0, parseInt(document.getElementById('teamKP')?.value, 10) || 0);
  const stPts = placementToPoints(position);
  const total = stPts + kp;
  const stPreview = document.getElementById('modalStPreview');
  const totalPreview = document.getElementById('modalTotalPreview');
  if (stPreview) stPreview.textContent = stPts.toLocaleString();
  if (totalPreview) totalPreview.textContent = total.toLocaleString();
}

// Build position select options HTML
function positionSelectOptions(selectedPosition) {
  const labels = ['1st — 10 pts', '2nd — 7 pts', '3rd — 5 pts', '4th — 4 pts',
                  '5th — 3 pts', '6th — 2 pts', '7th — 1 pt', '8th — 0 pts'];
  return labels.map((label, i) => {
    const val = i + 1;
    const selected = val === selectedPosition ? ' selected' : '';
    return `<option value="${val}"${selected}>${label}</option>`;
  }).join('');
}

function render(data) {
  currentData = data;
  const teams = data.teams || [];
  document.getElementById('titleInput').value = data.tournament.title || '';
  document.getElementById('subtitleInput').value = data.tournament.subtitle || '';
  document.getElementById('statusInput').value = data.tournament.status || 'LIVE';

  const medalEmojis = ['🥇', '🥈', '🥉'];

  adminBody.innerHTML = teams.map(team => {
    const isTop = team.rank <= 3;
    const b = Number(team.b || 0);
    const position = Number(team.position || 8);
    const pp = placementToPoints(position);  // ST points
    const kp = Number(team.kp || 0);
    const total = pp + kp;

    return `
      <tr data-id="${escapeHtml(team.id)}" class="${isTop ? 'top-row' : ''}">
        <td class="rank-col">
          <span class="rank-badge ${isTop ? 'rank-medal medal-' + team.rank : ''}">
            ${isTop ? medalEmojis[team.rank - 1] + ' ' : ''}#${team.rank}
          </span>
        </td>
        <td>
          <input class="inline-input name-input" value="${escapeHtml(team.name)}" maxlength="40" aria-label="Team name" />
        </td>
        <td class="text-center">
          <input class="score-input b-input text-center" type="number" min="0" max="9999" step="1" value="${b}" aria-label="Booyahs" />
        </td>
        <td class="text-center">
          <select class="score-input pos-select text-center" aria-label="Position">
            ${positionSelectOptions(position)}
          </select>
        </td>
        <td class="text-center">
          <span class="st-pts-display">${pp}</span>
        </td>
        <td class="text-center">
          <input class="score-input kp-input text-center" type="number" min="0" max="9999" step="1" value="${kp}" aria-label="Kill points" />
        </td>
        <td class="text-center">
          <span class="total-calc-display">${total.toLocaleString()}</span>
        </td>
        <td>
          <div class="action-wrap">
            <button class="small-btn save save-row" title="Save this team's points">SAVE</button>
            <button class="small-btn delete delete-row" title="Delete team">DEL</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  adminEmpty.hidden = teams.length > 0;
}

async function loadDashboard() {
  const data = await api('/api/admin/data', { method: 'GET' });
  render(data);
}

async function boot() {
  try {
    const result = await api('/api/admin/me', { method: 'GET' });
    csrfToken = result.csrfToken || null;
    setLoggedIn(result.authenticated);
    if (result.authenticated) await loadDashboard();
  } catch {
    setLoggedIn(false);
  }
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginMessage.textContent = 'Verifying credentials…';
  try {
    const res = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ id: document.getElementById('loginId').value, password: document.getElementById('loginPassword').value })
    });
    csrfToken = res.csrfToken || null;
    loginForm.reset();
    loginMessage.textContent = '';
    setLoggedIn(true);
    await loadDashboard();
  } catch (error) {
    loginMessage.textContent = error.message;
    loginMessage.style.color = '#c93b16';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  csrfToken = null;
  setLoggedIn(false);
});

const passwordForm = document.getElementById('passwordForm');
if (passwordForm) {
  passwordForm.addEventListener('submit', async event => {
    event.preventDefault();
    const msg = document.getElementById('passwordMessage');
    const oldPassword = document.getElementById('oldPasswordInput').value;
    const newPassword = document.getElementById('newPasswordInput').value;

    if (newPassword.length < 8) {
      msg.textContent = 'New password must be at least 8 characters long.';
      msg.style.color = '#c93b16';
      return;
    }

    msg.textContent = 'Updating password securely…';
    try {
      const res = await api('/api/admin/password', {
        method: 'PUT',
        body: JSON.stringify({ oldPassword, newPassword })
      });
      passwordForm.reset();
      msg.textContent = res.message || 'Password updated successfully!';
      msg.style.color = '#25823d';
    } catch (error) {
      msg.textContent = error.message;
      msg.style.color = '#c93b16';
    }
  });
}

document.getElementById('settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  const msg = document.getElementById('settingsMessage');
  msg.textContent = 'Saving…';
  try {
    const data = await api('/api/admin/tournament', {
      method: 'PUT',
      body: JSON.stringify({
        title: document.getElementById('titleInput').value,
        subtitle: document.getElementById('subtitleInput').value,
        status: document.getElementById('statusInput').value || 'LIVE'
      })
    });
    render(data);
    msg.textContent = 'Saved successfully.';
    msg.style.color = '#25823d';
  } catch (error) {
    msg.textContent = error.message;
    msg.style.color = '#c93b16';
  }
});

function openModal(team = null) {
  modalBackdrop.hidden = false;
  modalMessage.textContent = '';
  document.getElementById('modalTitle').textContent = team ? 'EDIT TEAM' : 'ADD TEAM';
  document.getElementById('teamId').value = team?.id || '';
  document.getElementById('teamName').value = team?.name || '';
  document.getElementById('teamB').value = team?.b ?? 0;
  document.getElementById('teamKP').value = team?.kp ?? 0;

  // Set position dropdown
  const posEl = document.getElementById('teamPosition');
  if (posEl) posEl.value = team?.position ?? 8;

  updateModalTotal();
  document.getElementById('teamName').focus();
}

function closeModal() {
  modalBackdrop.hidden = true;
}

document.getElementById('addTeamBtn').addEventListener('click', () => openModal());
document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('cancelModal').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', event => { if (event.target === modalBackdrop) closeModal(); });

// Live preview on position or kp change
['teamPosition', 'teamKP'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', updateModalTotal);
  if (el) el.addEventListener('input', updateModalTotal);
});

teamForm.addEventListener('submit', async event => {
  event.preventDefault();
  modalMessage.textContent = 'Saving…';
  const id = document.getElementById('teamId').value;
  const payload = {
    name: document.getElementById('teamName').value,
    b: Math.max(0, parseInt(document.getElementById('teamB').value, 10) || 0),
    position: Math.max(1, Math.min(8, parseInt(document.getElementById('teamPosition').value, 10) || 8)),
    kp: Math.max(0, parseInt(document.getElementById('teamKP').value, 10) || 0)
  };
  try {
    const data = await api(id ? `/api/admin/teams/${encodeURIComponent(id)}` : '/api/admin/teams', {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(payload)
    });
    render(data);
    closeModal();
    teamMessage.textContent = id ? 'Team updated. ST points & ranking recalculated.' : 'Team added. ST points auto-assigned from position.';
    teamMessage.style.color = '#25823d';
  } catch (error) {
    modalMessage.textContent = error.message;
    modalMessage.style.color = '#c93b16';
  }
});

// Live update: when position or kp changes in table row, update ST pts and total display
adminBody.addEventListener('change', event => {
  if (event.target.classList.contains('pos-select') || event.target.classList.contains('kp-input')) {
    const row = event.target.closest('tr');
    if (!row) return;
    const position = parseInt(row.querySelector('.pos-select')?.value, 10) || 8;
    const kp = Math.max(0, parseInt(row.querySelector('.kp-input')?.value, 10) || 0);
    const stPts = placementToPoints(position);
    const stDisplay = row.querySelector('.st-pts-display');
    const totalDisplay = row.querySelector('.total-calc-display');
    if (stDisplay) stDisplay.textContent = stPts;
    if (totalDisplay) totalDisplay.textContent = (stPts + kp).toLocaleString();
  }
});

adminBody.addEventListener('input', event => {
  if (event.target.classList.contains('kp-input')) {
    const row = event.target.closest('tr');
    if (!row) return;
    const position = parseInt(row.querySelector('.pos-select')?.value, 10) || 8;
    const kp = Math.max(0, parseInt(row.querySelector('.kp-input')?.value, 10) || 0);
    const stPts = placementToPoints(position);
    const totalDisplay = row.querySelector('.total-calc-display');
    if (totalDisplay) totalDisplay.textContent = (stPts + kp).toLocaleString();
  }
});

adminBody.addEventListener('click', async event => {
  const row = event.target.closest('tr');
  if (!row) return;
  const id = row.dataset.id;
  const existing = currentData.teams.find(team => team.id === id);
  if (!existing) return;

  if (event.target.classList.contains('save-row')) {
    const name = row.querySelector('.name-input').value;
    const b = Math.max(0, parseInt(row.querySelector('.b-input').value, 10) || 0);
    const position = Math.max(1, Math.min(8, parseInt(row.querySelector('.pos-select').value, 10) || 8));
    const kp = Math.max(0, parseInt(row.querySelector('.kp-input').value, 10) || 0);
    const origText = event.target.textContent;
    event.target.textContent = '…';
    try {
      render(await api(`/api/admin/teams/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ name, b, position, kp })
      }));
      teamMessage.textContent = `${name} saved. ST points auto-updated from position.`;
      teamMessage.style.color = '#25823d';
    } catch (error) {
      event.target.textContent = origText;
      teamMessage.textContent = error.message;
      teamMessage.style.color = '#c93b16';
    }
  }

  if (event.target.classList.contains('delete-row')) {
    if (!confirm(`Delete ${existing.name}?`)) return;
    try {
      render(await api(`/api/admin/teams/${encodeURIComponent(id)}`, { method:'DELETE' }));
      teamMessage.textContent = `${existing.name} deleted.`;
      teamMessage.style.color = '#25823d';
    } catch (error) {
      teamMessage.textContent = error.message;
      teamMessage.style.color = '#c93b16';
    }
  }
});

boot();
