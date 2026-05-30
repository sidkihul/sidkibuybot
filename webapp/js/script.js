// --- Global Utilities & State ---
const state = {
    bots: [],
    phoneNumber: '',
    isAdminAuth: false,
    globalVideoUrl: 'https://cdn.pixabay.com/video/2020/05/25/40131-424785461_large.mp4'
};

const uiEngine = {
    showToast: (message, type = 'info') => {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.style.borderLeftColor = type === 'error' ? '#ff5f56' : (type === 'success' ? '#27c93f' : '#38bdf8');
        toast.textContent = message;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
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
        // Handle UI Nav states
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        if(element) element.classList.add('active');
        else {
            // Find specific nav item if triggered via code
            const icons = { 'view-deploy': 0, 'view-files': 1, 'view-settings': 2, 'view-admin': 3 };
            document.querySelectorAll('.nav-item')[icons[viewId]].classList.add('active');
        }

        if(viewId === 'view-files') botsManager.renderList();
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
        
        // Simulate Network Request
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
            
            // Add bot to grid
            const newBot = {
                id: Math.random().toString(36).substr(2, 6),
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
        badge.textContent = `🟢 ${activeBots} / ${state.bots.length} Threads Online`;

        if (state.bots.length === 0) {
            container.innerHTML = `<p class="status-text text-center mt-20">No active userbot processes found.</p>`;
            return;
        }

        container.innerHTML = '';
        state.bots.forEach(bot => {
            const card = document.createElement('div');
            card.className = 'bot-card';
            card.innerHTML = `
                <div class="bot-info">
                    <h3>${bot.name} <span style="font-size: 0.7rem; color: #888;">[${bot.id}]</span></h3>
                    <p>${bot.phone} | Status: <span style="color: ${bot.status === 'online' ? '#27c93f' : '#ff5f56'}">${bot.status.toUpperCase()}</span></p>
                </div>
                <div class="bot-actions">
                    <button class="action-btn" onclick="terminal.open('${bot.id}')">📋 Logs</button>
                    <button class="action-btn ${bot.status === 'online' ? 'danger' : ''}" onclick="botsManager.toggleBot('${bot.id}')">
                        ${bot.status === 'online' ? '⏹ Stop' : '▶ Start'}
                    </button>
                </div>
            `;
            container.appendChild(card);
        });
    },

    toggleBot: (id) => {
        const bot = state.bots.find(b => b.id === id);
        if(bot) {
            bot.status = bot.status === 'online' ? 'offline' : 'online';
            uiEngine.showToast(`Process ${bot.id} ${bot.status === 'online' ? 'started' : 'terminated'}.`, bot.status === 'online' ? 'success' : 'error');
            botsManager.renderList();
        }
    }
};

// --- Admin Controls ---
const adminFlow = {
    verify: () => {
        const val = document.getElementById('adminPassInput').value;
        if(val === 'admin123' || val !== '') { // Accepts any string for demo
            uiEngine.setLoading('btn-admin-login', true);
            setTimeout(() => {
                uiEngine.setLoading('btn-admin-login', false);
                document.getElementById('admin-login-panel').classList.add('hidden');
                document.getElementById('admin-dash-panel').classList.remove('hidden');
                state.isAdminAuth = true;
                uiEngine.showToast('Root access granted.', 'success');
            }, 800);
        } else {
            uiEngine.showToast('Invalid system token.', 'error');
        }
    },

    togglePower: (isPowerOn) => {
        const statusText = document.getElementById('server-status-text');
        const badge = document.getElementById('global-server-badge');
        
        if(isPowerOn) {
            statusText.innerHTML = `<span class="pulse status-dot green" style="display:inline-block; font-size:0.8rem; margin-right:5px; color:#27c93f;">●</span>Primary Node Cluster operational`;
            statusText.style.color = '#27c93f';
            badge.textContent = '● Engine Online';
            badge.style.color = '#27c93f';
            badge.style.borderColor = '#27c93f';
            badge.style.background = 'rgba(39, 201, 63, 0.1)';
            uiEngine.showToast('Master engine booted successfully.', 'success');
        } else {
            statusText.innerHTML = `<span class="pulse status-dot red" style="display:inline-block; font-size:0.8rem; margin-right:5px; color:#ff5f56;">●</span>Node cluster offline`;
            statusText.style.color = '#ff5f56';
            badge.textContent = '● Engine Offline';
            badge.style.color = '#ff5f56';
            badge.style.borderColor = '#ff5f56';
            badge.style.background = 'rgba(255, 95, 86, 0.1)';
            uiEngine.showToast('Engine process killed.', 'error');
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
        output.innerHTML = ''; // Clear previous
        
        terminal.writeLog('Container boot initiated...');
        terminal.writeLog(`Loading Telethon sessions for ${botId}...`);
        
        setTimeout(() => terminal.writeLog('INFO: Connected to Telegram API.'), 600);
        setTimeout(() => terminal.writeLog('INFO: Registering event handlers (events.NewMessage)'), 1200);
        setTimeout(() => terminal.writeLog('SUCCESS: Userbot daemon is running in background.'), 1800);
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
