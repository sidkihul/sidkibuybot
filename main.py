import os
import sys
import subprocess
import asyncio
import psutil
import time
import json
import threading
from flask import Flask, request, jsonify, send_from_directory

# Setup Flask to serve the frontend from the 'webapp' folder natively
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
WEBAPP_DIR = os.path.join(BASE_DIR, "webapp")

app = Flask(__name__, static_folder=WEBAPP_DIR, static_url_path="")

# Core Storage Layout Config
SESSION_DIR = os.path.join(BASE_DIR, "userbot_sessions")
SCRIPTS_DIR = os.path.join(BASE_DIR, "userbot_scripts")
DB_FILE = os.path.join(BASE_DIR, "bots_config.json")

os.makedirs(SESSION_DIR, exist_ok=True)
os.makedirs(SCRIPTS_DIR, exist_ok=True)

# Application state dictionaries
ACTIVE_PROCESSES = {}
PENDING_HANDSHAKES = {}

# --- YOUR TELEGRAM CREDENTIALS ---
API_ID = 38843772  
API_HASH = "875fbb273801c8025d05e98173fca536"

# --- Database Management ---
def load_db():
    if os.path.exists(DB_FILE):
        with open(DB_FILE, "r") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return {}
    return {}

def save_db(data):
    with open(DB_FILE, "w") as f:
        json.dump(data, f, indent=4)

# --- Thread Safe Async Helper ---
def run_async(coro):
    """Safely runs Telethon async functions inside synchronous Flask routes."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()

# --- Robust Process Management Engine ---
def kill_process_tree(process_info):
    """Safely terminate a process and its children, preventing memory leaks."""
    pid = None
    try:
        if 'log_file' in process_info and hasattr(process_info['log_file'], 'close') and not process_info['log_file'].closed:
            try:
                process_info['log_file'].close()
            except Exception: pass

        process = process_info.get('process')
        if process and hasattr(process, 'pid'):
            pid = process.pid
            try:
                parent = psutil.Process(pid)
                children = parent.children(recursive=True)
                for child in children:
                    try: child.terminate()
                    except psutil.NoSuchProcess: pass
                
                gone, alive = psutil.wait_procs(children, timeout=1)
                for p in alive:
                    try: p.kill()
                    except Exception: pass
                    
                try:
                    parent.terminate()
                    parent.wait(timeout=1)
                except psutil.TimeoutExpired:
                    parent.kill()
                except psutil.NoSuchProcess: pass
            except psutil.NoSuchProcess: pass
    except Exception as e:
        print(f"Error killing process {pid}: {e}")

def trigger_deployment(phone_key, script_file_path, session_path, ext, custom_env_vars=None):
    """Deploys a script as a subprocess and registers it in the DB."""
    log_path = f"{script_file_path}.log"
    log_file_handle = open(log_path, "w", encoding="utf-8")
    executable = "node" if ext == ".js" else sys.executable
    
    startupinfo = None
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE

    # Inject default and user-defined environment variables
    custom_env = os.environ.copy()
    custom_env["TELEGRAM_SESSION_PATH"] = session_path
    custom_env["API_ID"] = str(API_ID)
    custom_env["API_HASH"] = API_HASH
    
    if custom_env_vars:
        for k, v in custom_env_vars.items():
            custom_env[str(k)] = str(v)

    proc = subprocess.Popen(
        [executable, "-u", script_file_path], 
        stdout=log_file_handle, 
        stderr=subprocess.STDOUT,
        startupinfo=startupinfo,
        env=custom_env
    )
    
    ACTIVE_PROCESSES[phone_key] = {
        'process': proc,
        'log_file': log_file_handle,
        'log_path': log_path,
        'start_time': time.time(),
        'target_state': 'running'
    }

    # Save to persistent database
    db = load_db()
    db[phone_key] = {
        "script_path": script_file_path,
        "session_path": session_path,
        "ext": ext,
        "env_vars": custom_env_vars or {}
    }
    save_db(db)

# --- Background Auto-Recovery Engine ---
def auto_recovery_worker():
    """Background thread to monitor and restart unexpectedly crashed bots."""
    while True:
        time.sleep(30)
        db = load_db()
        for phone_key, config in db.items():
            active_info = ACTIVE_PROCESSES.get(phone_key)
            if active_info and active_info.get('target_state') == 'running':
                proc = active_info.get('process')
                if not proc or proc.poll() is not None:
                    # Process died unexpectedly. Restart it.
                    print(f"[Auto-Recovery] Restarting crashed bot for {phone_key}")
                    kill_process_tree(active_info)
                    trigger_deployment(
                        phone_key, 
                        config["script_path"], 
                        config["session_path"], 
                        config["ext"], 
                        config.get("env_vars")
                    )

threading.Thread(target=auto_recovery_worker, daemon=True).start()

# --- Web Server Routes (Serving HTML/CSS/JS) ---
@app.route('/')
def serve_homepage():
    return send_from_directory(WEBAPP_DIR, 'index.html')

@app.route('/css/<path:path>')
def serve_css(path):
    return send_from_directory(os.path.join(WEBAPP_DIR, 'css'), path)

@app.route('/js/<path:path>')
def serve_js(path):
    return send_from_directory(os.path.join(WEBAPP_DIR, 'js'), path)

# --- API Endpoints ---

@app.route('/api/deploy/initiate', methods=['POST'])
def initiate_handshake():
    data = request.json or {}
    phone = data.get("phone")
    script_code = data.get("script")
    env_vars = data.get("env", {})

    if not phone or not script_code:
        return jsonify({"status": "error", "message": "Missing credentials or script."}), 400

    safe_phone = "".join(c for c in phone if c.isalnum() or c in "+")
    ext = ".js" if "console.log" in script_code or "require(" in script_code else ".py"
    script_path = os.path.join(SCRIPTS_DIR, f"{safe_phone}_main{ext}")
    session_path = os.path.join(SESSION_DIR, f"sess_{safe_phone}")
    
    with open(script_path, "w", encoding="utf-8") as f:
        f.write(script_code)

    async def request_code():
        from telethon import TelegramClient
        client = TelegramClient(session_path, API_ID, API_HASH)
        await client.connect()
        code_hash_ref = await client.send_code_request(phone)
        await client.disconnect()
        return code_hash_ref.phone_code_hash

    try:
        phone_code_hash = run_async(request_code())
        PENDING_HANDSHAKES[safe_phone] = {
            "phone_code_hash": phone_code_hash,
            "script_path": script_path,
            "session_path": session_path,
            "ext": ext,
            "env_vars": env_vars
        }
        return jsonify({"status": "awaiting_otp", "message": "OTP requested."})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/deploy/upload', methods=['POST'])
def handle_file_upload():
    """Alternative endpoint to allow users to upload actual script files."""
    if 'file' not in request.files or 'phone' not in request.form:
        return jsonify({"status": "error", "message": "Missing file or phone number"}), 400
        
    file = request.files['file']
    phone = request.form['phone']
    env_vars = json.loads(request.form.get('env', '{}'))
    
    if file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400

    safe_phone = "".join(c for c in phone if c.isalnum() or c in "+")
    ext = ".js" if file.filename.endswith(".js") else ".py"
    script_path = os.path.join(SCRIPTS_DIR, f"{safe_phone}_main{ext}")
    session_path = os.path.join(SESSION_DIR, f"sess_{safe_phone}")
    
    file.save(script_path)

    async def request_code():
        from telethon import TelegramClient
        client = TelegramClient(session_path, API_ID, API_HASH)
        await client.connect()
        code_hash_ref = await client.send_code_request(phone)
        await client.disconnect()
        return code_hash_ref.phone_code_hash

    try:
        phone_code_hash = run_async(request_code())
        PENDING_HANDSHAKES[safe_phone] = {
            "phone_code_hash": phone_code_hash,
            "script_path": script_path,
            "session_path": session_path,
            "ext": ext,
            "env_vars": env_vars
        }
        return jsonify({"status": "awaiting_otp", "message": "OTP requested."})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/deploy/verify-otp', methods=['POST'])
def verify_otp_challenge():
    data = request.json or {}
    phone = data.get("phone")
    otp_code = data.get("code")
    safe_phone = "".join(c for c in phone if c.isalnum() or c in "+")
    
    handshake = PENDING_HANDSHAKES.get(safe_phone)
    if not handshake: 
        return jsonify({"status": "error", "message": "Session expired or invalid."}), 400

    async def verify_code():
        from telethon import TelegramClient
        from telethon.errors import SessionPasswordNeededError
        client = TelegramClient(handshake["session_path"], API_ID, API_HASH)
        await client.connect()
        try:
            await client.sign_in(phone=phone, code=otp_code, phone_code_hash=handshake["phone_code_hash"])
            await client.disconnect()
            return "deployed"
        except SessionPasswordNeededError:
            await client.disconnect()
            return "awaiting_2fa"

    try:
        result = run_async(verify_code())
        if result == "deployed":
            trigger_deployment(safe_phone, handshake["script_path"], handshake["session_path"], handshake["ext"], handshake.get("env_vars"))
            del PENDING_HANDSHAKES[safe_phone]
            return jsonify({"status": "deployed"})
        elif result == "awaiting_2fa":
            return jsonify({"status": "awaiting_2fa"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/deploy/finalize', methods=['POST'])
def finalize_cloud_password():
    data = request.json or {}
    phone = data.get("phone")
    password = data.get("password")
    safe_phone = "".join(c for c in phone if c.isalnum() or c in "+")
    
    handshake = PENDING_HANDSHAKES.get(safe_phone)
    if not handshake: 
        return jsonify({"status": "error", "message": "Session expired."}), 400

    async def verify_2fa():
        from telethon import TelegramClient
        client = TelegramClient(handshake["session_path"], API_ID, API_HASH)
        await client.connect()
        await client.sign_in(password=password)
        await client.disconnect()

    try:
        run_async(verify_2fa())
        trigger_deployment(safe_phone, handshake["script_path"], handshake["session_path"], handshake["ext"], handshake.get("env_vars"))
        del PENDING_HANDSHAKES[safe_phone]
        return jsonify({"status": "deployed"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 401

@app.route('/api/bot/status', methods=['GET'])
def get_system_status():
    status_report = {}
    db = load_db()
    
    for phone_key in db.keys():
        process_info = ACTIVE_PROCESSES.get(phone_key)
        if process_info:
            proc = process_info.get('process')
            try:
                p = psutil.Process(proc.pid)
                if p.is_running() and p.status() != psutil.STATUS_ZOMBIE:
                    mem_mb = p.memory_info().rss / (1024 * 1024)
                    status_report[phone_key] = {
                        "status": "online",
                        "ram": f"{mem_mb:.1f}MB",
                        "uptime": round(time.time() - process_info['start_time'], 1)
                    }
                else:
                    status_report[phone_key] = {"status": "offline", "ram": "0MB"}
            except psutil.NoSuchProcess:
                status_report[phone_key] = {"status": "offline", "ram": "0MB"}
        else:
            status_report[phone_key] = {"status": "offline", "ram": "0MB"}
            
    return jsonify({"status": "success", "bots": status_report})

@app.route('/api/bot/control', methods=['POST'])
def control_threads():
    data = request.json or {}
    phone = data.get("phone")
    action = data.get("action")
    safe_phone = "".join(c for c in phone if c.isalnum() or c in "+")
    
    db = load_db()
    if safe_phone not in db and action != "logs":
         return jsonify({"status": "error", "message": "Bot not registered in database."}), 404

    process_info = ACTIVE_PROCESSES.get(safe_phone)
    config = db.get(safe_phone, {})

    if action == "stop":
        if process_info:
            process_info['target_state'] = 'stopped'
            kill_process_tree(process_info)
            ACTIVE_PROCESSES.pop(safe_phone, None)
            return jsonify({"status": "success", "message": "Process terminated."})
        return jsonify({"status": "error", "message": "Process already offline."})
        
    elif action == "start" or action == "restart":
        if process_info:
            kill_process_tree(process_info)
            ACTIVE_PROCESSES.pop(safe_phone, None)
        trigger_deployment(safe_phone, config["script_path"], config["session_path"], config["ext"], config.get("env_vars"))
        return jsonify({"status": "success", "message": f"Process {action}ed successfully."})
        
    elif action == "delete":
        if process_info:
            kill_process_tree(process_info)
            ACTIVE_PROCESSES.pop(safe_phone, None)
        
        # Remove DB entry and files
        del db[safe_phone]
        save_db(db)
        
        for file_path in [config.get("script_path"), f"{config.get('script_path')}.log", f"{config.get('session_path')}.session"]:
            if file_path and os.path.exists(file_path):
                os.remove(file_path)
                
        return jsonify({"status": "success", "message": "Bot deleted and wiped from server."})
        
    elif action == "logs":
        log_path = os.path.join(SCRIPTS_DIR, f"{safe_phone}_main.py.log")
        if not os.path.exists(log_path):
            log_path = os.path.join(SCRIPTS_DIR, f"{safe_phone}_main.js.log")
            
        if os.path.exists(log_path):
            with open(log_path, "r", encoding="utf-8") as f:
                lines = f.readlines()[-100:] # Increased log output
                return jsonify({"status": "success", "logs": "".join(lines)})
        return jsonify({"status": "success", "logs": "[System] Awaiting script output...\n"})

@app.route('/api/admin/stats', methods=['GET'])
def get_admin_stats():
    cpu_usage = psutil.cpu_percent(interval=0.1)
    ram_usage = psutil.virtual_memory().percent
    total_active_bots = sum(1 for info in ACTIVE_PROCESSES.values() if info.get('target_state') == 'running')
    db = load_db()
    
    return jsonify({
        "status": "success",
        "cpu": f"{cpu_usage}%",
        "ram": f"{ram_usage}%",
        "active_bots": total_active_bots,
        "total_registered_bots": len(db)
    })

def initialize_saved_bots():
    """Boots up all bots stored in the database on server start."""
    print("[System] Checking for previously deployed bots...")
    db = load_db()
    for phone_key, config in db.items():
        if os.path.exists(config["script_path"]):
            print(f"[System] Resuming bot session for {phone_key}...")
            trigger_deployment(
                phone_key, 
                config["script_path"], 
                config["session_path"], 
                config["ext"], 
                config.get("env_vars")
            )
        else:
            print(f"[System] Skipping {phone_key}: Script file missing.")

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 8080))
    # Boot saved bots before starting the web server
    initialize_saved_bots()
    print(f"🚀 SID Hosting Core initialized. Web interface bound to port {port}.")
    app.run(host='0.0.0.0', port=port, debug=False)
