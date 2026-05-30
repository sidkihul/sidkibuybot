// --- Global Utilities & State ---
const state = {
    bots: [],
    phoneNumber: '',
    isAdminAuth: false,
    walletBalance: 0,
    serverPower: true
};

const uiEngine = {
    showToast: (message, type = 'info') => {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.style.borderLeftColor = type === 'error' ? '#ff5f56' : (type === 'success' ? '#27c93f' : (type === 'warning' ? '#ffbd2e' : '#38bdf8'));
        toast.textContent = message;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
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
            uiEngine.showToast('Background updated successfully.', 'success');
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
        else {
            const icons = { 'view-deploy': 0, 'view-files': 1, 'view-settings': 2, 'view-admin': 3 };
            document.querySelectorAll('.nav-item')[icons[viewId]].classList.add('active');
        }

        if(viewId === 'view-files') botsManager.renderList();
        if(viewId === 'view-admin' && state.isAdminAuth) adminFlow.simulateLiveStats();
    }
};

// --- Deployment Flow ---
const deployFlow = {
    handleFileUpload: (e) => {
        const file = e.target.files[0];
        if(!file) return;
        
        const reader = new FileReader();
        reader.onload = function(evt) {
            document.getElementById('scriptInput').value = evt.target.result;
            document.getElementById('filename-display').textContent = file.name;
            uiEngine.showToast('Script loaded securely.', 'success');
        };
        reader.readAsText(file);
    },

    goBack: (currentId, targetId) => {
        document.getElementById(currentId).classList.add('hidden');
        document.getElementById(targetId).classList.remove('hidden');
    },

    nextToOTP: () => {
        const phone = document.getElementById('phoneInput').value;
        const script = document.getElementById('scriptInput').value;
        
        if (!phone || phone.length < 5) return uiEngine.showToast('Please enter a valid Telegram number.', 'error');
        if (!script) return uiEngine.showToast('Code engine requires a script to compile.', 'error');

        state.phoneNumber = phone;
        uiEngine.setLoading('btn-deploy', true);
        
        setTimeout(() => {
            uiEngine.setLoading('btn-deploy', false);
            document.getElementById('otp-phone-display').textContent = `Verification dispatched to ${phone}`;
            deployFlow.goBack('step1-script', 'step2-otp');
            uiEngine.showToast('Handshake initiated.', 'info');
        }, 1500);
    },

    nextToPassword: () => {
        const otp = document.getElementById('otpInput').value;
        if (!otp || otp.length < 5) return uiEngine.showToast('Invalid OTP token length.', 'error');

        uiEngine.setLoading('btn-otp', true);
        setTimeout(() => {
            uiEngine.setLoading('btn-otp', false);
            deployFlow.goBack('step2-otp', 'step3-password');
        }, 1200);
    },

    finalize: () => {
        uiEngine.setLoading('btn-pass', true);
        
        setTimeout(() => {
            uiEngine.setLoading('btn-pass', false);
            deployFlow.goBack('step3-password', 'step4-success');
            uiEngine.showToast('Container deployed successfully!', 'success');
            
            const newBot = {
                id: Math.random().toString(36).substr(2, 6).toUpperCase(),
                name: document.getElementById('filename-display').textContent,
                phone: state.phoneNumber,
                status: 'online'
            };
            state.bots.push(newBot);
        }, 2000);
    },

    reset: () => {
        document.getElementById('phoneInput').value = '';
        document.getElementById('scriptInput').value = '';
        document.getElementById('otpInput').value = '';
        document.getElementById('passwordInput').value = '';
        
        document.querySelectorAll('#view-deploy .glass-panel').forEach(p => p.classList.add('hidden'));
        document.getElementById('step1-script').classList.remove('hidden');
    }
};

// --- Bot Management ---
const botsManager = {
    renderList: () => {
        const container = document.getElementById('bots-list-container');
        const badge = document.getElementById('bot-count-badge');
        
        const activeBots = state.bots.filter(b => b.status === 'online').length;
        badge.innerHTML = `🟢 ${activeBots} Active / ${state.bots.length} Total`;

        if (state.bots.length === 0) {
            container.innerHTML = `<p class="status-text text-center mt-20">No active userbot processes found.</p>`;
            return;
        }

        container.innerHTML = '';
        state.bots.forEach(bot => {
            let statusColor = '#ff5f56'; 
            if(bot.status === 'online') statusColor = '#27c93f';
            if(bot.status === 'paused') statusColor = '#ffbd2e';

            const card = document.createElement('div');
            card.className = 'bot-card';
            card.innerHTML = `
                <div class="bot-info">
                    <h3>${bot.name} <span style="font-size: 0.7rem; color: #888;">[${bot.id}]</span></h3>
                    <p>${bot.phone} | Status: <span style="color: ${statusColor}; font-weight:bold;">${bot.status.toUpperCase()}</span></p>
                </div>
                <div class="bot-actions" style="align-items: center;">
                    <button class="action-btn" style="height: 32px; padding: 0 10px;" onclick="terminal.open('${bot.id}')">📋 Logs</button>
                    <div class="bot-controls">
                        <button class="ctrl-btn play" title="Start/Resume" onclick="botsManager.changeStatus('${bot.id}', 'online')">▶</button>
                        <button class="ctrl-btn pause" title="Pause" onclick="botsManager.changeStatus('${bot.id}', 'paused')">⏸</button>
                        <button class="ctrl-btn stop" title="Stop" onclick="botsManager.changeStatus('${bot.id}', 'offline')">⏹</button>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    },

    changeStatus: (id, newStatus) => {
        const bot = state.bots.find(b => b.id === id);
        if(!bot) return;
        
        if (bot.status === newStatus) return; // Ignore if same status

        bot.status = newStatus;
        
        let msg = '';
        let type = 'info';
        if(newStatus === 'online') { msg = `Process ${id} resumed.`; type = 'success'; }
        if(newStatus === 'paused') { msg = `Process ${id} paused/sleeping.`; type = 'warning'; }
        if(newStatus === 'offline') { msg = `Process ${id} fully terminated.`; type = 'error'; }
        
        uiEngine.showToast(msg, type);
        botsManager.renderList();
    }
};

// --- Settings & Wallet Flow ---
const settingsFlow = {
    addMoney: () => {
        const input = document.getElementById('upi-amount');
        const amount = parseFloat(input.value);

        if(isNaN(amount) || amount <= 0) {
            return uiEngine.showToast('Please enter a valid amount.', 'error');
        }

        const btn = input.nextElementSibling;
        const text = btn.querySelector('.btn-text');
        const spinner = btn.querySelector('.spinner');
        
        text.style.display = 'none';
        spinner.style.display = 'block';
        btn.disabled = true;

        setTimeout(() => {
            text.style.display = 'block';
            spinner.style.display = 'none';
            btn.disabled = false;
            
            state.walletBalance += amount;
            document.getElementById('wallet-balance').textContent = `₹${state.walletBalance.toFixed(2)}`;
            input.value = '';
            
            uiEngine.showToast(`₹${amount} added successfully via UPI!`, 'success');
        }, 1500);
    }
};

// --- Admin Controls ---
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
                adminFlow.simulateLiveStats(); 
                uiEngine.showToast('Root access granted.', 'success');
            }, 800);
        }
    },

    liveStatsInterval: null,

    simulateLiveStats: () => {
        if(!state.isAdminAuth) return;
        
        if(adminFlow.liveStatsInterval) clearInterval(adminFlow.liveStatsInterval);

        adminFlow.liveStatsInterval = setInterval(() => {
            if(!state.serverPower) return;
            const load = Math.floor(Math.random() * (85 - 20 + 1) + 20);
            const loadEl = document.getElementById('stat-load');
            if(loadEl) {
                loadEl.textContent = `${load}%`;
                loadEl.style.color = load > 75 ? '#ff5f56' : (load > 50 ? '#ffbd2e' : '#27c93f');
            }
        }, 3000);
    },

    togglePower: (isPowerOn) => {
        state.serverPower = isPowerOn;
        const badge = document.getElementById('global-server-badge');
        
        if(isPowerOn) {
            badge.textContent = '● Engine Online';
            badge.style.color = '#27c93f';
            badge.style.borderColor = '#27c93f';
            badge.style.background = 'rgba(39, 201, 63, 0.1)';
            uiEngine.showToast('Premium Node Engine booted.', 'success');
        } else {
            badge.textContent = '● Engine Offline';
            badge.style.color = '#ff5f56';
            badge.style.borderColor = '#ff5f56';
            badge.style.background = 'rgba(255, 95, 86, 0.1)';
            const loadEl = document.getElementById('stat-load');
            if(loadEl) {
                loadEl.textContent = '0%';
                loadEl.style.color = '#94a3b8';
            }
            uiEngine.showToast('All servers force killed.', 'error');
        }
    },

    updateGlobalBackground: () => {
        const url = document.getElementById('admin-video-url-input').value;
        if(url) {
            document.getElementById('bg-video').src = url;
            uiEngine.showToast('Global broadcast matrix updated.', 'info');
        }
    },

    logout: () => {
        state.isAdminAuth = false;
        if(adminFlow.liveStatsInterval) clearInterval(adminFlow.liveStatsInterval);
        document.getElementById('adminPassInput').value = '';
        document.getElementById('admin-dash-panel').classList.add('hidden');
        document.getElementById('admin-login-panel').classList.remove('hidden');
        uiEngine.showToast('Session tokens wiped.', 'info');
    }
};

// --- Terminal Simulator ---
const terminal = {
    open: (botId) => {
        document.getElementById('terminal-modal').classList.remove('hidden');
        document.getElementById('terminal-bot-name').textContent = `stdout_stream@${botId}`;
        const output = document.getElementById('terminal-output');
        output.innerHTML = ''; 
        
        const bot = state.bots.find(b => b.id === botId);
        
        if (bot && bot.status === 'offline') {
            terminal.writeLog(`ERROR: Process ${botId} is currently OFFLINE. Start the process to view live logs.`);
            return;
        }

        terminal.writeLog('Container boot initiated...');
        terminal.writeLog(`Loading Telethon sessions for ${botId}...`);
        
        setTimeout(() => { if(!document.getElementById('terminal-modal').classList.contains('hidden')) terminal.writeLog('INFO: Connected to Telegram API.'); }, 600);
        setTimeout(() => { if(!document.getElementById('terminal-modal').classList.contains('hidden')) terminal.writeLog('INFO: Registering event handlers (events.NewMessage)'); }, 1200);
        setTimeout(() => { if(!document.getElementById('terminal-modal').classList.contains('hidden')) terminal.writeLog('SUCCESS: Userbot daemon is running in background.'); }, 1800);
    },

    close: () => {
        document.getElementById('terminal-modal').classList.add('hidden');
    },

    writeLog: (message) => {
        const output = document.getElementById('terminal-output');
        const time = new Date().toLocaleTimeString();
        const el = document.createElement('div');
        el.className = 'terminal-line';
        el.innerHTML = `<span class="terminal-timestamp">[${time}]</span> ${message}`;
        output.appendChild(el);
        output.scrollTop = output.scrollHeight;
    }
};
