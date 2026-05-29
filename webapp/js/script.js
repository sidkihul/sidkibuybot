// --- State Monitoring ---
const AppState = { phone: '', scriptContent: '', activeBots: {} };

// --- Toast Notifications System ---
const toast = {
    show(message, type = 'success') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px;';
            document.body.appendChild(container);
        }

        const element = document.createElement('div');
        const bgColor = type === 'error' ? 'rgba(255, 95, 86, 0.9)' : 'rgba(39, 201, 63, 0.9)';
        element.style.cssText = `background: ${bgColor}; color: #fff; padding: 14px 24px; border-radius: 12px; font-size: 0.95rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5); backdrop-filter: blur(10px); transition: 0.3s; transform: translateY(20px); opacity: 0;`;
        element.innerText = message;
        container.appendChild(element);
        
        requestAnimationFrame(() => { element.style.transform = 'translateY(0)'; element.style.opacity = '1'; });
        setTimeout(() => { element.style.opacity = '0'; element.style.transform = 'translateY(-10px)'; setTimeout(() => element.remove(), 300); }, 4000);
    }
};

// --- Navigation Core ---
const nav = {
    switchTab(targetViewId, element) {
        document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
        document.getElementById(targetViewId).classList.remove('hidden');
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        if (element) element.classList.add('active');
    }
};

// --- UI / Aesthetics Engine ---
const uiEngine = {
    applyVideoSource(url) {
        const videoElement = document.getElementById('bg-video');
        if (videoElement && url) {
            videoElement.src = url;
            videoElement.load();
            videoElement.play().catch(() => console.warn("Video autoplay blocked."));
        }
    },
    updateBackgroundFromSettings() {
        const targetUrl = document.getElementById('video-url-input').value.trim();
        if (!targetUrl) return toast.show('Please enter a valid video URL.', 'error');
        this.applyVideoSource(targetUrl);
        const adminInput = document.getElementById('admin-video-url-input');
        if(adminInput) adminInput.value = targetUrl;
        toast.show('Background updated successfully.', 'success');
    }
};

// --- Live Resource Hosting Engine ---
const hostingEngine = {
    init() {
        // Poll for real-time memory and process statuses every 3 seconds
        setInterval(this.pollStatus.bind(this), 3000);
    },
    async pollStatus() {
        if (Object.keys(AppState.activeBots).length === 0) return;
        
        try {
            const response = await fetch('/api/bot/status');
            const data = await response.json();
            
            let requiresUIUpdate = false;
            
            if (data.status === 'success') {
                for (const [id, bot] of Object.entries(AppState.activeBots)) {
                    const liveStats = data.bots[bot.phoneKey];
                    if (liveStats) {
                        // Update UI only if metrics have changed to prevent DOM thrashing
                        if (bot.ram !== liveStats.ram || bot.status !== liveStats.status) {
                            bot.ram = liveStats.ram;
                            bot.status = liveStats.status;
                            requiresUIUpdate = true;
                        }
                    } else if (bot.status === 'Running') {
                        // Backend process was terminated externally or crashed
                        bot.status = 'Stopped';
                        bot.ram = '0.0MB';
                        requiresUIUpdate = true;
                    }
                }
            }
            if (requiresUIUpdate) deployFlow.syncBotListUI();
        } catch (e) {
            // Silently suppress polling errors to avoid console spam during network drops
        }
    }
};

// --- User Deployment Pipeline ---
const deployFlow = {
    handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('scriptInput').value = e.target.result;
            document.getElementById('filename-display').innerText = file.name;
            toast.show(`Imported: ${file.name}`);
        };
        reader.readAsText(file);
    },

    async nextToOTP() {
        const phone = document.getElementById('phoneInput').value.trim();
        const script = document.getElementById('scriptInput').value.trim();
        const btn = document.getElementById('btn-deploy');

        if (!phone || !script) return toast.show('Phone number and script cannot be blank.', 'error');

        AppState.phone = phone;
        btn.classList.add('loading');

        try {
            const response = await fetch('/api/deploy/initiate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phone, script: script })
            });
            const data = await response.json();
            btn.classList.remove('loading');

            if (data.status === 'awaiting_otp') {
                document.getElementById('otp-phone-display').innerText = `Verification code sent to ${phone}.`;
                this.goBack('step1-script', 'step2-otp');
                toast.show('Awaiting Telegram code.');
            } else {
                toast.show(data.message || 'Server error initiating session.', 'error');
            }
        } catch (err) {
            btn.classList.remove('loading');
            toast.show('Network failure.', 'error');
        }
    },

    async nextToPassword() {
        const otpCode = document.getElementById('otpInput').value.trim();
        const btn = document.getElementById('btn-otp');
        if (otpCode.length < 4) return toast.show('Invalid code length.', 'error');

        btn.classList.add('loading');

        try {
            const response = await fetch('/api/deploy/verify-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: AppState.phone, code: otpCode })
            });
            const data = await response.json();
            btn.classList.remove('loading');

            if (data.status === 'awaiting_2fa') {
                this.goBack('step2-otp', 'step3-password');
                toast.show('2FA detected. Password required.');
            } else if (data.status === 'deployed') {
                this.handleSuccessfulDeployment();
            } else {
                toast.show(data.message || 'OTP failed.', 'error');
            }
        } catch (err) {
            btn.classList.remove('loading');
            toast.show('Network failure.', 'error');
        }
    },

    async finalize() {
        const password = document.getElementById('passwordInput').value;
        const btn = document.getElementById('btn-pass');
        if (!password) return toast.show('Password required.', 'error');

        btn.classList.add('loading');

        try {
            const response = await fetch('/api/deploy/finalize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: AppState.phone, password: password })
            });
            const data = await response.json();
            btn.classList.remove('loading');

            if (data.status === 'deployed') {
                this.handleSuccessfulDeployment();
            } else {
                toast.show(data.message || 'Incorrect Password.', 'error');
            }
        } catch (err) {
            btn.classList.remove('loading');
            toast.show('Deployment failed.', 'error');
        }
    },

    handleSuccessfulDeployment() {
        document.getElementById('step2-otp').classList.add('hidden');
        document.getElementById('step3-password').classList.add('hidden');
        document.getElementById('step4-success').classList.remove('hidden');
        
        const fileName = document.getElementById('filename-display').innerText;
        const safeId = AppState.phone.replace(/[^0-9]/g, ''); 
        
        // Initializing with temporary string. HostingEngine poll will overwrite this rapidly.
        AppState.activeBots[safeId] = { phoneKey: AppState.phone, name: fileName, status: 'Running', uptime: '0m', ram: 'Pending...' };
        this.syncBotListUI();
        toast.show('Userbot activated successfully!', 'success');
    },

    goBack(hideId, showId) {
        document.getElementById(hideId).classList.add('hidden');
        document.getElementById(showId).classList.remove('hidden');
    },

    reset() {
        this.goBack('step4-success', 'step1-script');
        document.getElementById('phoneInput').value = '';
        document.getElementById('otpInput').value = '';
        document.getElementById('passwordInput').value = '';
    },

    syncBotListUI() {
        const container = document.getElementById('bots-list-container');
        const badge = document.getElementById('bot-count-badge');
        if (!container) return;
        
        let onlineCount = 0; let totalCount = 0; let html = '';

        for (const [id, bot] of Object.entries(AppState.activeBots)) {
            totalCount++;
            const isRunning = bot.status === 'Running';
            if (isRunning) onlineCount++;

            html += `
            <div class="file-item" id="bot-${id}">
                <div class="file-info-header">
                    <div>
                        <div class="file-name" style="${isRunning ? '' : 'color: #94a3b8;'}">${bot.name}</div>
                        <div class="file-status">${isRunning ? 'Container Active' : 'Process Interrupted'} • Allocated: ${bot.ram}</div>
                    </div>
                    <span class="status-dot ${isRunning ? 'green pulse' : 'red'}">●</span>
                </div>
                <div class="file-actions">
                    <button class="action-btn" onclick="terminal.open('${bot.phoneKey}', '${bot.name}')">📝 Logs</button>
                    ${isRunning ? 
                        `<button class="action-btn danger" onclick="botControl.stop('${id}')">⏹ Terminate</button>` :
                        `<button class="action-btn danger" onclick="botControl.delete('${id}')">🗑 Wipe</button>`
                    }
                </div>
            </div>`;
        }

        if (totalCount === 0) {
            html = `<p class="status-text text-center mt-20">No active processes found. Deploy a script to start.</p>`;
        }

        container.innerHTML = html;
        if (badge) {
            badge.innerText = `🟢 ${onlineCount} Threads Online`;
            badge.className = onlineCount > 0 ? "badge active-badge" : "badge premium-badge";
        }
    }
};

// --- Process Control Engine ---
const botControl = {
    async stop(botId) {
        const bot = AppState.activeBots[botId];
        if (!bot) return;
        toast.show(`Sending termination signal...`);
        try {
            const response = await fetch('/api/bot/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: bot.phoneKey, action: 'stop' })
            });
            const data = await response.json();
            if (data.status === 'stopped' || data.status === 'error') {
                AppState.activeBots[botId].status = 'Stopped';
                AppState.activeBots[botId].ram = '0.0MB';
                deployFlow.syncBotListUI();
                toast.show(`Process natively terminated.`, 'error');
            }
        } catch (e) { toast.show('Network error', 'error'); }
    },
    delete(botId) {
        if(confirm(`Wipe data contexts for this bot?`)) {
            delete AppState.activeBots[botId];
            deployFlow.syncBotListUI();
            toast.show(`Process wiped from view.`);
        }
    }
};

// --- Live Terminal Logs Engine ---
window.terminal = {
    async open(phoneKey, botName) {
        document.getElementById('terminal-modal').classList.remove('hidden');
        document.getElementById('terminal-bot-name').innerText = `stdout@${botName}`;
        const output = document.getElementById('terminal-output');
        output.innerHTML = `<p style="color: #64748b;">[system] Hooking stdout stream matrix for process: ${botName}...</p>`;
        
        try {
            const response = await fetch('/api/bot/control', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phoneKey, action: 'logs' })
            });
            const data = await response.json();
            
            if (data.status === 'success' && data.logs) {
                const logLines = data.logs.split('\n').filter(l => l.trim() !== '');
                let formattedHtml = '';
                logLines.forEach(line => { formattedHtml += `<p><span style="color: #a7f3d0;">${line}</span></p>`; });
                output.innerHTML += formattedHtml;
            } else {
                output.innerHTML += `<p style="color: var(--sys-yellow);">[warn] Log file is empty or unreadable.</p>`;
            }
        } catch (e) {
            output.innerHTML += `<p style="color: var(--sys-red);">[error] Network interrupt: Unable to fetch live logs.</p>`;
        }
        output.scrollTop = output.scrollHeight;
    },
    close() { document.getElementById('terminal-modal').classList.add('hidden'); }
};

// --- Admin Flow ---
const adminFlow = {
    verify() {
        const pass = document.getElementById('adminPassInput').value;
        const btn = document.getElementById('btn-admin-login');
        btn.classList.add('loading');
        setTimeout(() => {
            btn.classList.remove('loading');
            if (pass === 'sid999') {
                document.getElementById('admin-login-panel').classList.add('hidden');
                document.getElementById('admin-dash-panel').classList.remove('hidden');
                document.getElementById('adminPassInput').value = '';
                toast.show('Root access validation confirmed.', 'success');
            } else {
                toast.show('Access Denied.', 'error');
            }
        }, 1000);
    },
    logout() {
        document.getElementById('admin-dash-panel').classList.add('hidden');
        document.getElementById('admin-login-panel').classList.remove('hidden');
        toast.show('Tokens securely flushed.');
    },
    togglePower(isPowerOn) {
        const indicator = document.getElementById('server-status-text');
        const badge = document.getElementById('global-server-badge');
        if (isPowerOn) {
            indicator.style.color = 'var(--sys-green)';
            indicator.innerHTML = '<span class="pulse status-dot green">●</span>Primary Node Cluster operational';
            badge.className = "badge active-badge"; badge.innerText = "● Engine Online";
            toast.show('Hypervisor instances awakened.', 'success');
        } else {
            indicator.style.color = 'var(--sys-red)';
            indicator.innerHTML = '<span class="status-dot red">●</span>System Offline.';
            badge.className = "badge premium-badge"; badge.innerText = "⏹ Engine Dead";
            toast.show('System Warning: Engines killed.', 'error');
        }
    },
    updateGlobalBackground() {
        const targetUrl = document.getElementById('admin-video-url-input').value.trim();
        uiEngine.applyVideoSource(targetUrl);
        const userSettingsInput = document.getElementById('video-url-input');
        if (userSettingsInput) userSettingsInput.value = targetUrl;
        toast.show('Global background updated.');
    }
};

window.uiEngine = uiEngine;
document.addEventListener('DOMContentLoaded', () => {
    deployFlow.syncBotListUI();
    hostingEngine.init(); 
});
