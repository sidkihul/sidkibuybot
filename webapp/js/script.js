// --- Global Utilities & State ---
const state = {
    phoneNumber: '',
    isAdminAuth: false,
    walletBalance: 0.00,
    pollingInterval: null
};

const API_BASE = window.location.origin; // Dynamically uses current host (e.g. http://localhost:8080)

const uiEngine = {
    showToast: (message, type = 'info') => {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        let icon = type === 'success' ? '✅ ' : (type === 'error' ? '❌ ' : 'ℹ️ ');
        toast.style.borderLeftColor = type === 'error' ? '#ff5f56' : (type === 'success' ? '#27c93f' : '#38bdf8');
        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.transform = 'translateX(120%)';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 400);
        }, 3500);
    },
    
    setLoading: (btnId, isLoading) => {
        const btn = document.getElementById(btnId);
        if(!btn) return;
        const text = btn.querySelector('.btn-text');
        const spinner = btn.querySelector('.spinner');
        
        if (isLoading) {
            if(text) text.style.display = 'none';
            if(spinner) spinner.style.display = 'block';
            btn.disabled = true;
        } else {
            if(text) text.style.display = 'block';
            if(spinner) spinner.style.display = 'none';
            btn.disabled = false;
        }
    },

    updateBackgroundFromSettings: () => {
        const url = document.getElementById('video-url-input').value;
        if(url) {
            document.getElementById('bg-video').src = url;
            uiEngine.showToast('Background matrix updated.', 'success');
        }
    }
};

// --- Navigation ---
const nav = {
    switchTab: (viewId, element) => {
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        if(element) element.classList.add('active');

        // Manage background polling based on active tab
        if(state.pollingInterval) clearInterval(state.pollingInterval);
        
        if (viewId === 'view-files') {
            botsManager.fetchBots();
            state.pollingInterval = setInterval(botsManager.fetchBots, 5000);
        } else if (viewId === 'view-admin' && state.isAdminAuth) {
            adminFlow.fetchStats();
            state.pollingInterval = setInterval(adminFlow.fetchStats, 3000);
        }
    }
};

// --- Real Backend Deployment Flow ---
const deployFlow = {
    handleFileUpload: (e) => {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = function(evt) {
            document.getElementById('scriptInput').value = evt.target.result;
            document.getElementById('filename-display').textContent = file.name;
            uiEngine.showToast('Script loaded securely into editor.', 'success');
        };
        reader.readAsText(file);
    },

    goBack: (currentId, targetId) => {
        document.getElementById(currentId).classList.add('hidden');
        document.getElementById(targetId).classList.remove('hidden');
    },

    nextToOTP: async () => {
        const phone = document.getElementById('phoneInput').value.trim();
        const script = document.getElementById('scriptInput').value.trim();
        
        if (!phone || phone.length < 5) return uiEngine.showToast('Invalid Telegram number.', 'error');
        if (!script) return uiEngine.showToast('Code engine requires a script.', 'error');

        state.phoneNumber = phone;
        uiEngine.setLoading('btn-deploy', true);
        
        try {
            const res = await fetch(`${API_BASE}/api/deploy/initiate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, script })
            });
            const data = await res.json();
            
            if (data.status === 'awaiting_otp') {
                document.getElementById('otp-phone-display').textContent = `Verification sent to ${phone}`;
                deployFlow.goBack('step1-script', 'step2-otp');
                uiEngine.showToast('Handshake initiated. Check Telegram.', 'info');
            } else {
                uiEngine.showToast(data.message, 'error');
            }
        } catch (err) {
            uiEngine.showToast('Node connection failed.', 'error');
        }
        uiEngine.setLoading('btn-deploy', false);
    },

    nextToPassword: async () => {
        const code = document.getElementById('otpInput').value.trim();
        if (!code) return uiEngine.showToast('Enter the OTP code.', 'error');

        uiEngine.setLoading('btn-otp', true);
        try {
            const res = await fetch(`${API_BASE}/api/deploy/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: state.phoneNumber, code })
            });
            const data = await res.json();
            
            if (data.status === 'deployed') {
                deployFlow.goBack('step2-otp', 'step4-success');
                uiEngine.showToast('Container deployed successfully!', 'success');
            } else if (data.status === 'awaiting_2fa') {
                deployFlow.goBack('step2-otp', 'step3-password');
                uiEngine.showToast('2FA required for this account.', 'info');
            } else {
                uiEngine.showToast(data.message, 'error');
            }
        } catch (err) {
            uiEngine.showToast('OTP Verification failed.', 'error');
        }
        uiEngine.setLoading('btn-otp', false);
    },

    finalize: async () => {
        const password = document.getElementById('passwordInput').value;
        if (!password) return uiEngine.showToast('Enter 2FA password.', 'error');

        uiEngine.setLoading('btn-pass', true);
        try {
            const res = await fetch(`${API_BASE}/api/deploy/finalize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: state.phoneNumber, password })
            });
            const data = await res.json();
            
            if (data.status === 'deployed') {
                deployFlow.goBack('step3-password', 'step4-success');
                uiEngine.showToast('Session unlocked. Container deployed!', 'success');
            } else {
                uiEngine.showToast(data.message, 'error');
            }
        } catch (err) {
            uiEngine.showToast('Deployment failed.', 'error');
        }
        uiEngine.setLoading('btn-pass', false);
    },

    reset: () => {
        document.getElementById('phoneInput').value = '';
        document.getElementById('otpInput').value = '';
        document.getElementById('passwordInput').value = '';
        document.querySelectorAll('#view-deploy .glass-panel').forEach(p => p.classList.add('hidden'));
        document.getElementById('step1-script').classList.remove('hidden');
    }
};

// --- Bot Management (Real API Integration) ---
const botsManager = {
    fetchBots: async () => {
        try {
            const res = await fetch(`${API_BASE}/api/bot/status`);
            const data = await res.json();
            if (data.status === 'success') botsManager.renderList(data.bots);
        } catch (err) {
            console.error('Failed to fetch bot grid.');
        }
    },

    renderList: (botsObj) => {
        const container = document.getElementById('bots-list-container');
        const badge = document.getElementById('bot-count-badge');
        const botKeys = Object.keys(botsObj);
        
        badge.innerHTML = `🟢 ${botKeys.length} Thread(s) Online`;

        if (botKeys.length === 0) {
            container.innerHTML = `<p class="status-text text-center mt-20">No active process clusters found.</p>`;
            return;
        }

        container.innerHTML = '';
        botKeys.forEach(phoneId => {
            const bot = botsObj[phoneId];
            const card = document.createElement('div');
            card.className = 'bot-card';
            card.innerHTML = `
                <div class="bot-info">
                    <h3>Thread [${phoneId}]</h3>
                    <p>Status: <span style="color: #27c93f; font-weight:bold;">${bot.status.toUpperCase()}</span> | RAM: ${bot.ram}</p>
                </div>
                <div class="bot-actions">
                    <button class="action-btn" onclick="terminal.open('${phoneId}')">📋 View Logs</button>
                    <button class="action-btn danger" onclick="botsManager.killBot('${phoneId}')">⏹ Kill Task</button>
                </div>
            `;
            container.appendChild(card);
        });
    },

    killBot: async (phoneId) => {
        if(!confirm(`Terminate core process for ${phoneId}?`)) return;
        try {
            const res = await fetch(`${API_BASE}/api/bot/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phoneId, action: 'stop' })
            });
            const data = await res.json();
            uiEngine.showToast(data.message || 'Task killed.', data.status);
            botsManager.fetchBots();
        } catch (err) {
            uiEngine.showToast('Failed to kill process.', 'error');
        }
    }
};

// --- Settings / Wallet Simulation ---
const settingsFlow = {
    addMoney: () => {
        const input = document.getElementById('upi-amount');
        const amount = parseFloat(input.value);
        if(isNaN(amount) || amount <= 0) return uiEngine.showToast('Enter valid amount.', 'error');

        uiEngine.setLoading(input.nextElementSibling.id, true); // Use button reference internally
        const btn = input.nextElementSibling;
        const text = btn.querySelector('.btn-text');
        const spinner = btn.querySelector('.spinner');
        
        text.style.display = 'none';
        spinner.style.display = 'block';
        
        setTimeout(() => {
            text.style.display = 'block';
            spinner.style.display = 'none';
            state.walletBalance += amount;
            document.getElementById('wallet-balance').textContent = `₹${state.walletBalance.toFixed(2)}`;
            input.value = '';
            uiEngine.showToast(`₹${amount} added securely via UPI!`, 'success');
        }, 1500);
    }
};

// --- Admin Controls (Real API Integration) ---
const adminFlow = {
    verify: () => {
        const val = document.getElementById('adminPassInput').value;
        if(val !== '') { 
            uiEngine.setLoading('btn-admin-login', true);
            setTimeout(() => {
                uiEngine.setLoading('btn-admin-login', false);
                document.getElementById('admin-login-panel').classList.add('hidden');
                document.getElementById('admin-dash-panel').classList.remove('hidden');
                state.isAdminAuth = true;
                adminFlow.fetchStats();
                state.pollingInterval = setInterval(adminFlow.fetchStats, 3000);
                uiEngine.showToast('Root access granted.', 'success');
            }, 800);
        }
    },

    fetchStats: async () => {
        if(!state.isAdminAuth) return;
        try {
            const res = await fetch(`${API_BASE}/api/admin/stats`);
            const data = await res.json();
            if (data.status === 'success') {
                document.getElementById('stat-cpu').textContent = data.cpu;
                document.getElementById('stat-ram').textContent = data.ram;
                document.getElementById('stat-bots').textContent = data.active_bots;
            }
        } catch (err) {
            console.error('Failed to fetch admin stats.');
        }
    },

    togglePower: (isPowerOn) => {
        const badge = document.getElementById('global-server-badge');
        if(isPowerOn) {
            badge.textContent = '● Online';
            badge.style.color = '#27c93f';
            badge.style.borderColor = '#27c93f';
            badge.style.background = 'rgba(39, 201, 63, 0.2)';
            uiEngine.showToast('Premium Node Engine booted.', 'success');
        } else {
            badge.textContent = '● Offline';
            badge.style.color = '#ff5f56';
            badge.style.borderColor = '#ff5f56';
            badge.style.background = 'rgba(255, 95, 86, 0.2)';
            document.getElementById('stat-cpu').textContent = '0%';
            document.getElementById('stat-ram').textContent = '0%';
            uiEngine.showToast('All servers force killed.', 'error');
        }
    },

    logout: () => {
        state.isAdminAuth = false;
        if(state.pollingInterval) clearInterval(state.pollingInterval);
        document.getElementById('adminPassInput').value = '';
        document.getElementById('admin-dash-panel').classList.add('hidden');
        document.getElementById('admin-login-panel').classList.remove('hidden');
        uiEngine.showToast('Session tokens wiped.', 'info');
    }
};

// --- Terminal Simulator (Real Log Fetching) ---
let logInterval = null;

const terminal = {
    open: (phoneId) => {
        document.getElementById('terminal-modal').classList.remove('hidden');
        document.getElementById('terminal-bot-name').textContent = `syslog@${phoneId}`;
        document.getElementById('terminal-output').innerHTML = '<div class="terminal-line">Connecting to core subsystem...</div>';
        
        terminal.fetchLogs(phoneId);
        logInterval = setInterval(() => terminal.fetchLogs(phoneId), 3000);
    },

    close: () => {
        document.getElementById('terminal-modal').classList.add('hidden');
        if(logInterval) clearInterval(logInterval);
    },

    fetchLogs: async (phoneId) => {
        try {
            const res = await fetch(`${API_BASE}/api/bot/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phoneId, action: 'logs' })
            });
            const data = await res.json();
            const output = document.getElementById('terminal-output');
            
            if (data.status === 'success' && data.logs) {
                // Format plain text to HTML lines
                const lines = data.logs.split('\n').map(line => 
                    line.trim() ? `<div class="terminal-line">${line.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : ''
                ).join('');
                
                output.innerHTML = lines || '<div class="terminal-line">[System] Waiting for script stdout...</div>';
                output.scrollTop = output.scrollHeight;
            }
        } catch (err) {
            document.getElementById('terminal-output').innerHTML += `<div class="terminal-line" style="color:#ff5f56">[System Error] Log fetch failed.</div>`;
        }
    }
};
