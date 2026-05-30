// --- Global Utilities & State ---
const state = {
    bots: [],
    phoneNumber: '',
    isAdminAuth: false,
    serverPower: true
};

const uiEngine = {
    showToast: (message, type = 'info') => {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.style.borderLeftColor = type === 'error' ? 'var(--danger)' : (type === 'success' ? 'var(--success)' : (type === 'warning' ? 'var(--warning)' : 'var(--primary)'));
        toast.textContent = message;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 400);
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
        const videoElement = document.getElementById('bg-video');
        if(url) {
            videoElement.style.opacity = 0; // Fade out
            setTimeout(() => {
                videoElement.src = url;
                videoElement.play();
                videoElement.style.opacity = 1; // Fade in
                uiEngine.showToast('Background updated successfully.', 'success');
            }, 500);
        }
    },

    uploadLocalBackground: (event) => {
        const file = event.target.files[0];
        if(!file) return;

        // Check if it's a video
        if(!file.type.startsWith('video/')) {
            return uiEngine.showToast('Please select a valid video file.', 'error');
        }

        const videoElement = document.getElementById('bg-video');
        const fileURL = URL.createObjectURL(file); // Create local blob URL
        
        videoElement.style.opacity = 0; // Fade out
        setTimeout(() => {
            videoElement.src = fileURL;
            videoElement.play();
            videoElement.style.opacity = 1; // Fade in
            uiEngine.showToast('Local background applied.', 'success');
        }, 500);
    }
};

// --- Navigation ---
const nav = {
    switchTab: (viewId, element) => {
        // Hide all views completely
        document.querySelectorAll('.view-section').forEach(el => {
            el.classList.remove('active');
            setTimeout(() => { if(!el.classList.contains('active')) el.style.display = 'none'; }, 300); // Wait for fade out
        });
        
        // Show the targeted view with animation
        const targetView = document.getElementById(viewId);
        if (targetView) {
            targetView.style.display = 'block';
            // Slight delay to allow display:block to apply before adding opacity class
            setTimeout(() => {
                targetView.classList.add('active');
            }, 10);
        }
        
        // Update Bottom Nav Highlighting
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        if(element) {
            element.classList.add('active');
        } else {
            const icons = { 'view-deploy': 0, 'view-files': 1, 'view-settings': 2, 'view-admin': 3 };
            if(icons[viewId] !== undefined) {
                document.querySelectorAll('.nav-item')[icons[viewId]].classList.add('active');
            }
        }

        // Trigger view-specific logic
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
        
        document.getElementById('step4-success').classList.add('hidden');
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
        state.bots.forEach((bot, index) => {
            let statusColor = 'var(--danger)'; 
            if(bot.status === 'online') statusColor = 'var(--success)';
            if(bot.status === 'paused') statusColor = 'var(--warning)';

            const card = document.createElement('div');
            card.className = 'bot-card';
            card.style.animationDelay = `${index * 0.1}s`; // Stagger animation
            card.innerHTML = `
                <div class="bot-info">
                    <h3>${bot.name} <span style="font-size: 0.7rem; color: #888;">[${bot.id}]</span></h3>
                    <p>${bot.phone} | Status: <span style="color: ${statusColor}; font-weight:bold;">${bot.status.toUpperCase()}</span></p>
                </div>
                <div class="bot-actions" style="align-items: center; display: flex;">
                    <button class="action-btn" style="height: 32px; padding: 0 10px;" onclick="terminal.open('${bot.id}')">📋 Logs</button>
                    <div class="bot-controls" style="margin-left: 10px;">
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
        if (bot.status === newStatus) return;

        bot.status = newStatus;
        
        let msg = '';
        let type = 'info';
        if(newStatus === 'online') { msg = `Process ${id} resumed.`; type = 'success'; }
        if(newStatus === 'paused') { msg = `Process ${id} paused.`; type = 'warning'; }
        if(newStatus === 'offline') { msg = `Process ${id} terminated.`; type = 'error'; }
        
        uiEngine.showToast(msg, type);
        botsManager.renderList();
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
                uiEngine.showToast('Root access granted.', 'success');
            }, 800);
        }
    },

    togglePower: (isPowerOn) => {
        state.serverPower = isPowerOn;
        const badge = document.getElementById('global-server-badge');
        
        if(isPowerOn) {
            badge.textContent = '● Engine Online';
            badge.style.color = 'var(--success)';
            badge.style.borderColor = 'var(--success)';
            badge.style.background = 'rgba(39, 201, 63, 0.1)';
            uiEngine.showToast('Premium Node Engine booted.', 'success');
        } else {
            badge.textContent = '● Engine Offline';
            badge.style.color = 'var(--danger)';
            badge.style.borderColor = 'var(--danger)';
            badge.style.background = 'rgba(255, 95, 86, 0.1)';
            uiEngine.showToast('All servers force killed.', 'error');
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
        const modal = document.getElementById('terminal-modal');
        modal.classList.remove('hidden');
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
        
        setTimeout(() => { if(!modal.classList.contains('hidden')) terminal.writeLog('INFO: Connected to Telegram API.', 'var(--primary)'); }, 600);
        setTimeout(() => { if(!modal.classList.contains('hidden')) terminal.writeLog('INFO: Registering event handlers (events.NewMessage)', 'var(--text-main)'); }, 1200);
        setTimeout(() => { if(!modal.classList.contains('hidden')) terminal.writeLog('SUCCESS: Userbot daemon is running in background.', 'var(--success)'); }, 1800);
    },

    close: () => {
        document.getElementById('terminal-modal').classList.add('hidden');
    },

    writeLog: (message, color = '#a6accd') => {
        const output = document.getElementById('terminal-output');
        const time = new Date().toLocaleTimeString();
        const el = document.createElement('div');
        el.className = 'terminal-line';
        el.style.color = color;
        el.innerHTML = `<span class="terminal-timestamp" style="color: var(--primary);">[${time}]</span> ${message}`;
        output.appendChild(el);
        output.scrollTop = output.scrollHeight;
    }
};
