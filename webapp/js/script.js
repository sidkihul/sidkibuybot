// This ensures that when ANY user loads the site, it fetches the global background
document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/config')
        .then(res => res.json())
        .then(data => {
            if(data.bg_video) {
                document.getElementById('bg-video').src = data.bg_video;
            }
        }).catch(console.error);

    // [NEW] Fetch current user's profile to check if they are Premium
    fetch('/api/user/profile')
        .then(res => res.json())
        .then(data => {
            if(data.status === 'success') {
                state.isPremium = data.isPremium || false;
            }
        }).catch(console.error);
        
    // Start polling bot statuses from the backend
    setInterval(botsManager.pollServerStatus, 5000);
    botsManager.pollServerStatus();
});

// --- Global Utilities & State ---
const state = {
    bots: [],
    phoneNumber: '',
    isAdminAuth: false,
    walletBalance: 0,
    serverPower: true,
    uploadedFile: null, // Added to track actual ZIP/JS/PY files for backend
    isPremium: false    // [NEW] Tracks if the user has premium limits
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
        document.querySelectorAll('.view-section').forEach(el => {
            el.classList.remove('active');
            el.classList.add('hidden');
        });
        
        const targetView = document.getElementById(viewId);
        if (targetView) {
            targetView.classList.remove('hidden');
            targetView.classList.add('active');
        }
        
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        if(element) {
            element.classList.add('active');
        } else {
            const icons = { 'view-deploy': 0, 'view-files': 1, 'view-settings': 2, 'view-admin': 3 };
            if(icons[viewId] !== undefined) {
                document.querySelectorAll('.nav-item')[icons[viewId]].classList.add('active');
            }
        }

        if(viewId === 'view-files') botsManager.renderList();
        if(viewId === 'view-admin' && state.isAdminAuth) adminFlow.simulateLiveStats();
    }
};

// --- Deployment Flow (Wired to Python API) ---
const deployFlow = {
    handleFileUpload: (e) => {
        const file = e.target.files[0];
        if(!file) return;
        
        state.uploadedFile = file; // Save physical file for backend upload
        document.getElementById('filename-display').textContent = file.name;
        
        if(!file.name.endsWith('.zip')) {
            const reader = new FileReader();
            reader.onload = function(evt) {
                document.getElementById('scriptInput').value = evt.target.result;
            };
            reader.readAsText(file);
        } else {
            document.getElementById('scriptInput').value = "[ZIP Archive loaded securely for backend extraction]";
        }
        uiEngine.showToast('File loaded securely.', 'success');
    },

    goBack: (currentId, targetId) => {
        document.getElementById(currentId).classList.add('hidden');
        document.getElementById(targetId).classList.remove('hidden');
    },

    nextToOTP: () => {
        const phone = document.getElementById('phoneInput').value;
        const script = document.getElementById('scriptInput').value;
        
        if (!phone || phone.length < 5) return uiEngine.showToast('Please enter a valid Telegram number.', 'error');
        if (!script && !state.uploadedFile) return uiEngine.showToast('Code engine requires a script to compile.', 'error');

        // [NEW] Free user check limit before allowing deployment
        if (!state.isPremium && state.bots.length >= 2) {
            return uiEngine.showToast('Free users are limited to 2 files/bots. Contact Admin to upgrade to Premium.', 'error');
        }

        state.phoneNumber = phone;
        uiEngine.setLoading('btn-deploy', true);
        
        // Decide whether to send raw JSON text or a File via FormData to the Python backend
        let fetchPromise;
        if (state.uploadedFile) {
            const formData = new FormData();
            formData.append('file', state.uploadedFile);
            formData.append('phone', phone);
            
            fetchPromise = fetch('/api/deploy/upload', { method: 'POST', body: formData });
        } else {
            fetchPromise = fetch('/api/deploy/initiate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phone, script: script })
            });
        }

        fetchPromise
            .then(res => res.json())
            .then(data => {
                uiEngine.setLoading('btn-deploy', false);
                if(data.status === 'awaiting_otp') {
                    document.getElementById('otp-phone-display').textContent = `Verification dispatched to ${phone}`;
                    deployFlow.goBack('step1-script', 'step2-otp');
                    uiEngine.showToast(data.message, 'info');
                } else {
                    uiEngine.showToast(data.message, 'error');
                }
            })
            .catch(err => {
                uiEngine.setLoading('btn-deploy', false);
                uiEngine.showToast('Server communication failed.', 'error');
            });
    },

    nextToPassword: () => {
        const otp = document.getElementById('otpInput').value;
        if (!otp || otp.length < 5) return uiEngine.showToast('Invalid OTP token length.', 'error');

        uiEngine.setLoading('btn-otp', true);
        
        fetch('/api/deploy/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: state.phoneNumber, code: otp })
        })
        .then(res => res.json())
        .then(data => {
            uiEngine.setLoading('btn-otp', false);
            if(data.status === 'awaiting_2fa') {
                deployFlow.goBack('step2-otp', 'step3-password');
                uiEngine.showToast('Cloud password required.', 'warning');
            } else if (data.status === 'deployed') {
                deployFlow.goBack('step2-otp', 'step4-success');
                uiEngine.showToast('Container deployed successfully!', 'success');
                botsManager.pollServerStatus(); // Refresh UI instantly
            } else {
                uiEngine.showToast(data.message, 'error');
            }
        }).catch(err => {
            uiEngine.setLoading('btn-otp', false);
            uiEngine.showToast('OTP verification failed.', 'error');
        });
    },

    finalize: () => {
        const pass = document.getElementById('passwordInput').value;
        uiEngine.setLoading('btn-pass', true);
        
        fetch('/api/deploy/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: state.phoneNumber, password: pass })
        })
        .then(res => res.json())
        .then(data => {
            uiEngine.setLoading('btn-pass', false);
            if (data.status === 'deployed') {
                deployFlow.goBack('step3-password', 'step4-success');
                uiEngine.showToast('Container deployed successfully!', 'success');
                botsManager.pollServerStatus();
            } else {
                uiEngine.showToast(data.message, 'error');
            }
        }).catch(err => {
            uiEngine.setLoading('btn-pass', false);
            uiEngine.showToast('2FA verification failed.', 'error');
        });
    },

    reset: () => {
        document.getElementById('phoneInput').value = '';
        document.getElementById('scriptInput').value = '';
        document.getElementById('otpInput').value = '';
        document.getElementById('passwordInput').value = '';
        document.getElementById('filename-display').textContent = 'No file selected';
        state.uploadedFile = null;
        
        document.querySelectorAll('#view-deploy .glass-panel').forEach(p => p.classList.add('hidden'));
        document.getElementById('step1-script').classList.remove('hidden');
    }
};

// --- Bot Management (Wired to Python API) ---
const botsManager = {
    pollServerStatus: () => {
        fetch('/api/bot/status')
            .then(res => res.json())
            .then(data => {
                if(data.status === 'success') {
                    // Map Python response format to your frontend format
                    state.bots = Object.keys(data.bots).map(phoneKey => ({
                        id: phoneKey,
                        name: `Bot_${phoneKey.slice(-4)}`, // Fallback name
                        phone: phoneKey,
                        status: data.bots[phoneKey].status
                    }));
                    
                    // Only re-render if we are on the files view to save performance
                    if(document.getElementById('view-files').classList.contains('active')) {
                        botsManager.renderList();
                    }
                }
            }).catch(console.error);
    },

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
                        <button class="ctrl-btn play" title="Start/Resume" onclick="botsManager.changeStatus('${bot.id}', 'start')">▶</button>
                        <button class="ctrl-btn stop" title="Stop" onclick="botsManager.changeStatus('${bot.id}', 'stop')">⏹</button>
                        <button class="ctrl-btn pause" style="color:#ff5f56;" title="Delete Bot" onclick="botsManager.changeStatus('${bot.id}', 'delete')">🗑</button>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    },

    changeStatus: (id, action) => {
        fetch('/api/bot/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: id, action: action })
        })
        .then(res => res.json())
        .then(data => {
            if(data.status === 'success') {
                let type = action === 'delete' || action === 'stop' ? 'warning' : 'success';
                uiEngine.showToast(data.message, type);
                botsManager.pollServerStatus(); // Instantly fetch updated state from Python
            } else {
                uiEngine.showToast(data.message, 'error');
            }
        });
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

// --- Admin Controls (Wired to Python API) ---
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

    // [NEW] Fetch user statistics and render premium management list
    fetchUserStats: () => {
        if(!state.isAdminAuth) return;
        fetch('/api/admin/user-stats')
            .then(res => res.json())
            .then(data => {
                const statsContainer = document.getElementById('admin-user-stats');
                if(statsContainer && data.status === 'success') {
                    let html = `
                        <div style="margin-bottom: 15px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                            <strong>User Stats:</strong><br>
                            Total Users: ${data.totalUsers} | Premium: ${data.premiumUsers} | Active Bots: ${data.totalBots}
                        </div>
                        <h4>Manage Users</h4>
                        <div style="max-height: 200px; overflow-y: auto;">
                    `;
                    data.usersList.forEach(u => {
                        const premiumBtn = !u.isPremium 
                            ? `<button onclick="adminFlow.grantPremium('${u.phone}')" style="background:#27c93f; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:12px;">Make Premium</button>` 
                            : `<span style="color:#27c93f; font-size:12px;">✓ Premium</span>`;
                        
                        html += `
                            <div style="display:flex; justify-content:space-between; margin-bottom:8px; padding:6px; background: rgba(0,0,0,0.2); border-radius:4px;">
                                <span>${u.phone}</span>
                                ${premiumBtn}
                            </div>
                        `;
                    });
                    html += `</div>`;
                    statsContainer.innerHTML = html;
                }
            }).catch(console.error);
    },

    // [NEW] Grant premium status to a specific user
    grantPremium: (userPhone) => {
        fetch('/api/admin/grant-premium', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: userPhone })
        })
        .then(res => res.json())
        .then(data => {
            if(data.status === 'success') {
                uiEngine.showToast(`Upgraded ${userPhone} to Premium!`, 'success');
                adminFlow.fetchUserStats(); // Instant refresh of stats panel
            } else {
                uiEngine.showToast(data.message, 'error');
            }
        });
    },

    simulateLiveStats: () => {
        if(!state.isAdminAuth) return;
        if(adminFlow.liveStatsInterval) clearInterval(adminFlow.liveStatsInterval);

        adminFlow.liveStatsInterval = setInterval(() => {
            if(!state.serverPower) return;
            
            // Fetch real backend hardware stats from Python
            fetch('/api/admin/stats')
                .then(res => res.json())
                .then(data => {
                    const loadEl = document.getElementById('stat-load');
                    if(loadEl && data.status === 'success') {
                        loadEl.textContent = data.cpu;
                        const loadNum = parseFloat(data.cpu);
                        loadEl.style.color = loadNum > 75 ? '#ff5f56' : (loadNum > 50 ? '#ffbd2e' : '#27c93f');
                    }
                }).catch(console.error);
                
            // [NEW] Fetch user data on the same tick
            adminFlow.fetchUserStats();
        }, 3000);
    },

    togglePower: (isPowerOn) => {
        state.serverPower = isPowerOn;
        const badge = document.getElementById('global-server-badge');
        
        // [NEW] API call to backend to forcefully start/stop all scripts
        fetch('/api/admin/power', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ power: isPowerOn ? 'on' : 'off' })
        }).catch(console.error);

        if(isPowerOn) {
            badge.textContent = '● Engine Online';
            badge.style.color = '#27c93f';
            badge.style.borderColor = '#27c93f';
            badge.style.background = 'rgba(39, 201, 63, 0.1)';
            uiEngine.showToast('Premium Node Engine booted. All scripts starting...', 'success'); // [UPDATED] Toast
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
            uiEngine.showToast('All servers force killed. All scripts stopped.', 'error'); // [UPDATED] Toast
        }
    },

    uploadGlobalBackground: (event) => {
        const file = event.target.files[0];
        if(!file) return;

        if(!file.type.startsWith('video/')) {
            return uiEngine.showToast('Please select a valid video file.', 'error');
        }

        uiEngine.showToast('Uploading to global server...', 'info');
        
        const formData = new FormData();
        formData.append('file', file);

        fetch('/api/admin/upload-bg', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if(data.status === 'success') {
                const videoElement = document.getElementById('bg-video');
                videoElement.style.opacity = 0;
                setTimeout(() => {
                    videoElement.src = data.url;
                    videoElement.play();
                    videoElement.style.opacity = 1;
                    uiEngine.showToast('Global background broadcasted to all users!', 'success');
                }, 500);
            } else {
                uiEngine.showToast(data.message, 'error');
            }
        }).catch(e => uiEngine.showToast('Upload failed.', 'error'));
    },

    updateGlobalBackgroundURL: () => {
        const url = document.getElementById('admin-video-url-input').value;
        if(!url) return uiEngine.showToast('Please enter a valid URL', 'error');

        fetch('/api/admin/set-bg-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url })
        })
        .then(res => res.json())
        .then(data => {
            if(data.status === 'success') {
                const videoElement = document.getElementById('bg-video');
                videoElement.style.opacity = 0;
                setTimeout(() => {
                    videoElement.src = data.url;
                    videoElement.play();
                    videoElement.style.opacity = 1;
                    uiEngine.showToast('Global background URL updated!', 'success');
                }, 500);
            }
        });
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

// --- Terminal Simulator (Wired to Python Logs) ---
let logPollInterval;

const terminal = {
    open: (botId) => {
        document.getElementById('terminal-modal').classList.remove('hidden');
        document.getElementById('terminal-bot-name').textContent = `stdout_stream@${botId}`;
        const output = document.getElementById('terminal-output');
        output.innerHTML = ''; 
        
        terminal.writeLog('Fetching live logs from Python backend...');
        
        // Fetch logs instantly, then poll every 2 seconds
        terminal.fetchLogs(botId);
        if(logPollInterval) clearInterval(logPollInterval);
        logPollInterval = setInterval(() => terminal.fetchLogs(botId), 2000);
    },

    fetchLogs: (botId) => {
        fetch('/api/bot/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: botId, action: 'logs' })
        })
        .then(res => res.json())
        .then(data => {
            const output = document.getElementById('terminal-output');
            if(data.status === 'success' && data.logs) {
                // Formatting raw text logs into terminal HTML
                output.innerHTML = '';
                const lines = data.logs.split('\n');
                lines.forEach(line => {
                    if(line.trim() !== '') {
                        const el = document.createElement('div');
                        el.className = 'terminal-line';
                        el.textContent = line; // secure text insertion
                        output.appendChild(el);
                    }
                });
                output.scrollTop = output.scrollHeight;
            }
        }).catch(err => console.error("Log fetch failed", err));
    },

    close: () => {
        document.getElementById('terminal-modal').classList.add('hidden');
        if(logPollInterval) clearInterval(logPollInterval);
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
