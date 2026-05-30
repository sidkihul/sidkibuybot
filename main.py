import os
import sys
import subprocess
import asyncio
import psutil
import time
from flask import Flask, request, jsonify

# Setup Flask to serve the frontend from the 'webapp' folder
app = Flask(__name__, static_folder="webapp", static_url_path="")

# Core Storage Layout Config
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
SESSION_DIR = os.path.join(BASE_DIR, "userbot_sessions")
SCRIPTS_DIR = os.path.join(BASE_DIR, "userbot_scripts")
os.makedirs(SESSION_DIR, exist_ok=True)
os.makedirs(SCRIPTS_DIR, exist_ok=True)

# Application state dictionaries
ACTIVE_PROCESSES = {}
PENDING_HANDSHAKES = {}

# --- YOUR TELEGRAM CREDENTIALS ---
API_ID = 38843772 
API_HASH = "875fbb273801c8025d05e98173fca536"

# --- Thread Safe Async Helper ---
def run_async(coro):
    """Safely runs Telethon async functions inside synchronous Flask routes."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()

# --- Robust Process Management Engine (Hosting Logic) ---
def kill_process_tree(process_info):
    """Safely terminate a process and its children, preventing memory leaks."""
    pid = None
    try:
        if 'log_file' in process_info and hasattr(process_info['log_file'], 'close') and not process_info['log_file'].closed:
            try:
                process_info['log_file'].close()
            except Exception as log_e:
                print(f"Error closing log file: {log_e}")

        process = process_info.get('process')
        if process and hasattr(process, 'pid'):
            pid = process.pid
            try:
                parent = psutil.Process(pid)
                children = parent.children(recursive=True)
                
                for child in children:
                    try:
                        child.terminate()
                    except psutil.NoSuchProcess:
                        pass
                
                gone, alive = psutil.wait_procs(children, timeout=1)
                for p in alive:
                    try: p.kill()
                    except Exception: pass
                    
                try:
                    parent.terminate()
                    parent.wait(timeout=1)
                except psutil.TimeoutExpired:
                    parent.kill()
                except psutil.NoSuchProcess:
                    pass

            except psutil.NoSuchProcess:
                pass
    except Exception as e:
        print(f"Unexpected error killing process tree for PID {pid}: {e}")

# --- Web Server Routes ---
@app.route('/')
def serve_homepage():
    return app.send_static_file('index.html')

# --- API Endpoints ---
@app.route('/api/deploy/initiate', methods=['POST'])
def initiate_handshake():
    data = request.json or {}
    phone = data.get("phone")
    script_code = data.get("script")

    if not phone or not script_code:
        return jsonify({"status": "error", "message": "Missing credentials or script."}), 400

    safe_phone = "".join(c for c in phone if c.isalnum() or c in "+")
    ext = ".js" if "console.log" in script_code or "require(" in script_code else ".py"
    script_path = os.path.join(SCRIPTS_DIR, f"{safe_phone}_main{ext}")
    
    # Store session directly in the SESSION_DIR
    session_path = os.path.join(SESSION_DIR, f"sess_{safe_phone}")
    
    # Save the script to disk
    with open(script_path, "w", encoding="utf-8") as f:
        f.write(script_code)

    async def request_code():
        from telethon import TelegramClient
        # Use a fresh connection to avoid SQLite database locks
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
            "ext": ext
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
        return jsonify({"status": "error", "message": "Session expired."}), 400

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
            trigger_deployment(safe_phone, handshake["script_path"], handshake["session_path"], handshake["ext"])
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
        return jsonify({"status": "error", "message": "Expired"}), 400

    async def verify_2fa():
        from telethon import TelegramClient
        client = TelegramClient(handshake["session_path"], API_ID, API_HASH)
        await client.connect()
        await client.sign_in(password=password)
        await client.disconnect()

    try:
        run_async(verify_2fa())
        trigger_deployment(safe_phone, handshake["script_path"], handshake["session_path"], handshake["ext"])
        del PENDING_HANDSHAKES[safe_phone]
        return jsonify({"status": "deployed"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 401

def trigger_deployment(phone_key, script_file_path, session_path, ext):
    log_path = f"{script_file_path}.log"
    log_file_handle = open(log_path, "w", encoding="utf-8")
    
    executable = "node" if ext == ".js" else sys.executable
    
    # Process Execution Flags
    startupinfo = None
    creationflags = 0
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE

    # Inject authenticated session path into the environment
    custom_env = os.environ.copy()
    custom_env["TELEGRAM_SESSION_PATH"] = session_path
    custom_env["API_ID"] = str(API_ID)
    custom_env["API_HASH"] = API_HASH

    proc = subprocess.Popen(
        [executable, script_file_path], 
        stdout=log_file_handle, 
        stderr=subprocess.STDOUT,
        startupinfo=startupinfo,
        creationflags=creationflags,
        env=custom_env
    )
    
    ACTIVE_PROCESSES[phone_key] = {
        'process': proc,
        'log_file': log_file_handle,
        'log_path': log_path,
        'start_time': time.time()
    }

@app.route('/api/bot/status', methods=['GET'])
def get_system_status():
    status_report = {}
    for phone_key, info in list(ACTIVE_PROCESSES.items()):
        proc = info.get('process')
        if proc:
            try:
                p = psutil.Process(proc.pid)
                if p.is_running() and p.status() != psutil.STATUS_ZOMBIE:
                    mem_mb = p.memory_info().rss / (1024 * 1024)
                    status_report[phone_key] = {
                        "status": "Running",
                        "ram": f"{mem_mb:.1f}MB"
                    }
                else:
                    kill_process_tree(info)
                    ACTIVE_PROCESSES.pop(phone_key, None)
            except psutil.NoSuchProcess:
                ACTIVE_PROCESSES.pop(phone_key, None)
    
    return jsonify({"status": "success", "bots": status_report})

@app.route('/api/bot/control', methods=['POST'])
def control_threads():
    data = request.json or {}
    phone = data.get("phone")
    action = data.get("action")
    safe_phone = "".join(c for c in phone if c.isalnum() or c in "+")
    
    if action == "stop":
        process_info = ACTIVE_PROCESSES.get(safe_phone)
        if process_info:
            kill_process_tree(process_info)
            ACTIVE_PROCESSES.pop(safe_phone, None)
            return jsonify({"status": "stopped"})
        return jsonify({"status": "error", "message": "Not running."})
        
    elif action == "logs":
        log_path = os.path.join(SCRIPTS_DIR, f"{safe_phone}_main.py.log")
        if not os.path.exists(log_path):
            log_path = os.path.join(SCRIPTS_DIR, f"{safe_phone}_main.js.log")
            
        if os.path.exists(log_path):
            with open(log_path, "r", encoding="utf-8") as f:
                lines = f.readlines()[-100:] 
                return jsonify({"status": "success", "logs": "".join(lines)})
        return jsonify({"status": "success", "logs": "[System] No logs generated yet."})

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 8080))
    print(f"🚀 SID Hosting Cloud Node running on port {port}...")
    app.run(host='0.0.0.0', port=port, debug=False)
