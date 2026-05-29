import asyncio
import sqlite3
import time
from datetime import datetime
from aiogram import Bot, Dispatcher, F
from aiogram.types import (
    Message, CallbackQuery, LabeledPrice, PreCheckoutQuery
)
from aiogram.filters import CommandStart, Command
from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

# --- CONFIGURATION ---
BOT_TOKEN = "8650706516:AAHw04CwFcdy5uvQjeaasHAkr1QL1yTl3ac"
PROVIDER_TOKEN = "YOUR_RAZORPAY_TOKEN_HERE" # From BotFather
ADMIN_ID = 123456789 # Replace with your Telegram User ID

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# --- FSM STATES ---
class AdminStates(StatesGroup):
    waiting_for_video = State()

# --- DATABASE SETUP ---
def init_db():
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY, wallet REAL DEFAULT 0, is_premium INTEGER DEFAULT 0)''')
    c.execute('''CREATE TABLE IF NOT EXISTS active_bots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, bot_count INTEGER, expires_at REAL)''')
    c.execute('''CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount REAL, timestamp REAL)''')
    # Settings table to store dynamic data like the menu video ID
    c.execute('''CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)''')
    conn.commit()
    conn.close()

def get_db_value(query, params=(), fetchone=True):
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    c.execute(query, params)
    res = c.fetchone() if fetchone else c.fetchall()
    conn.close()
    return res

def execute_db(query, params=()):
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    c.execute(query, params)
    conn.commit()
    conn.close()

def get_setting(key):
    res = get_db_value("SELECT value FROM settings WHERE key = ?", (key,))
    return res[0] if res else None

def set_setting(key, value):
    execute_db("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))

# --- REUSABLE MENUS & NAVIGATION ---
def get_main_menu(user_id):
    builder = InlineKeyboardBuilder()
    # Embellished with emojis to give a lively, "animated" feel
    builder.button(text="✨ 👤 Profile ✨", callback_data="profile")
    builder.button(text="💎 💰 Wallet 💎", callback_data="wallet")
    builder.button(text="🚀 🛒 Buy Hosted Bots 🚀", callback_data="buy_bots")
    builder.button(text="📜 Purchase History", callback_data="history")
    builder.button(text="📞 Support", url="https://t.me/your_admin_handle")
    
    if user_id == ADMIN_ID:
        builder.button(text="🛠️ Admin Dashboard ⚙️", callback_data="admin_panel")
        builder.adjust(2, 1, 2, 1) # Layout adjusts based on admin button presence
    else:
        builder.adjust(2, 1, 2)
        
    return builder.as_markup()

def get_back_button():
    builder = InlineKeyboardBuilder()
    builder.button(text="🔙 Return to Main Menu", callback_data="main_menu")
    return builder.as_markup()

async def safe_menu_edit(callback: CallbackQuery, text: str, reply_markup):
    """Safely transitions between video messages and text messages without crashing."""
    try:
        if callback.message.video or callback.message.animation:
            await callback.message.delete()
            await callback.message.answer(text, reply_markup=reply_markup, parse_mode="Markdown")
        else:
            await callback.message.edit_text(text, reply_markup=reply_markup, parse_mode="Markdown")
    except Exception:
        await callback.message.delete()
        await callback.message.answer(text, reply_markup=reply_markup, parse_mode="Markdown")

# --- CORE NAVIGATION ---
@dp.message(CommandStart())
async def start_cmd(message: Message, state: FSMContext):
    await state.clear()
    execute_db("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (message.from_user.id,))
    
    caption = "🤖 **Welcome to the Premium Bot Hosting Service!**\n\nSelect an option below to manage your account."
    video_id = get_setting("menu_video")
    
    if video_id:
        await message.answer_video(video=video_id, caption=caption, reply_markup=get_main_menu(message.from_user.id), parse_mode="Markdown")
    else:
        await message.answer(caption, reply_markup=get_main_menu(message.from_user.id), parse_mode="Markdown")

@dp.callback_query(F.data == "main_menu")
async def back_to_main(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    caption = "🤖 **Main Menu**\n\nSelect an option below to manage your account."
    video_id = get_setting("menu_video")
    
    await callback.message.delete()
    if video_id:
        await callback.message.answer_video(video=video_id, caption=caption, reply_markup=get_main_menu(callback.from_user.id), parse_mode="Markdown")
    else:
        await callback.message.answer(caption, reply_markup=get_main_menu(callback.from_user.id), parse_mode="Markdown")

# --- USER DASHBOARD ---
@dp.callback_query(F.data == "profile")
async def show_profile(callback: CallbackQuery):
    user = get_db_value("SELECT wallet, is_premium FROM users WHERE user_id = ?", (callback.from_user.id,))
    active = get_db_value("SELECT SUM(bot_count) FROM active_bots WHERE user_id = ?", (callback.from_user.id,))
    active_count = active[0] if active and active[0] else 0
    
    text = (f"👤 **Your Profile**\n\n"
            f"🆔 User ID: `{callback.from_user.id}`\n"
            f"👑 Status: {'Premium User ⭐' if user[1] else 'Standard User'}\n"
            f"🤖 Active Hosted Bots: **{active_count}**\n")
    await safe_menu_edit(callback, text, get_back_button())

@dp.callback_query(F.data == "wallet")
async def show_wallet(callback: CallbackQuery):
    user = get_db_value("SELECT wallet FROM users WHERE user_id = ?", (callback.from_user.id,))
    text = (f"💰 **Wallet Dashboard**\n\n"
            f"**Current Balance:** ₹{user[0]:.2f}\n\n"
            f"*(Funds are deducted directly at checkout via UPI.)*")
    await safe_menu_edit(callback, text, get_back_button())

@dp.callback_query(F.data == "history")
async def show_history(callback: CallbackQuery):
    records = get_db_value("SELECT amount, timestamp FROM purchases WHERE user_id = ? ORDER BY timestamp DESC LIMIT 5", (callback.from_user.id,), fetchone=False)
    if not records:
        text = "📜 **Purchase History**\n\nYou have not made any purchases yet."
    else:
        text = "📜 **Recent Purchases (Last 5)**\n\n"
        for idx, row in enumerate(records, 1):
            date_str = datetime.fromtimestamp(row[1]).strftime('%Y-%m-%d %H:%M')
            text += f"{idx}. ₹{row[0]:.2f} on {date_str}\n"
    await safe_menu_edit(callback, text, get_back_button())

# --- PURCHASING & AUTOMATED ACCESS ---
@dp.callback_query(F.data == "buy_bots")
async def buy_bots_menu(callback: CallbackQuery):
    builder = InlineKeyboardBuilder()
    builder.button(text="⚡ 15 Bots (24 Hours) - ₹30 ⚡", callback_data="invoice_15_24")
    builder.button(text="🔙 Back", callback_data="main_menu")
    builder.adjust(1)
    text = "🛒 **Store**\n\nSelect a hosting package. Access is automatically revoked when time expires."
    await safe_menu_edit(callback, text, builder.as_markup())

@dp.callback_query(F.data == "invoice_15_24")
async def send_hosting_invoice(callback: CallbackQuery):
    price = LabeledPrice(label="15 Hosted Bots (24h)", amount=30 * 100)
    await bot.send_invoice(
        chat_id=callback.from_user.id,
        title="Premium Hosting: 15 Bots",
        description="24 hours of premium server access for 15 bots.",
        payload="bot_pkg_15_24",
        provider_token=PROVIDER_TOKEN,
        currency="INR",
        prices=[price]
    )
    await callback.answer("Invoice generated!")

@dp.pre_checkout_query()
async def pre_checkout_handler(pre_checkout: PreCheckoutQuery):
    await bot.answer_pre_checkout_query(pre_checkout.id, ok=True)

@dp.message(F.successful_payment)
async def successful_payment_handler(message: Message):
    user_id = message.from_user.id
    amount = message.successful_payment.total_amount / 100 
    expires_at = time.time() + (24 * 3600)
    
    execute_db("INSERT INTO active_bots (user_id, bot_count, expires_at) VALUES (?, ?, ?)", (user_id, 15, expires_at))
    execute_db("UPDATE users SET is_premium = 1 WHERE user_id = ?", (user_id,))
    execute_db("INSERT INTO purchases (user_id, amount, timestamp) VALUES (?, ?, ?)", (user_id, amount, time.time()))
    
    await message.answer("✅ **Payment successful!**\n\nYou have been granted premium access for 15 bots for the next 24 hours.", parse_mode="Markdown")

# --- FULL ADMIN DASHBOARD ---
@dp.callback_query(F.data == "admin_panel")
async def admin_panel_callback(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID:
        return await callback.answer("Unauthorized", show_alert=True)
        
    builder = InlineKeyboardBuilder()
    builder.button(text="📊 User Stats", callback_data="admin_stats")
    builder.button(text="💸 Payment Logs", callback_data="admin_payments")
    builder.button(text="🎬 Set Menu Video", callback_data="admin_set_video")
    builder.button(text="🗑️ Remove Menu Video", callback_data="admin_remove_video")
    builder.button(text="🔙 Exit Admin", callback_data="main_menu")
    builder.adjust(2, 2, 1)
    
    text = "🛠 **Command Center**\n\nManage the bot, view statistics, and update the UI."
    await safe_menu_edit(callback, text, builder.as_markup())

@dp.callback_query(F.data == "admin_stats")
async def admin_stats(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID: return
    total_users = get_db_value("SELECT COUNT(*) FROM users")[0]
    total_rev = get_db_value("SELECT SUM(amount) FROM purchases")[0] or 0.0
    active_bots = get_db_value("SELECT SUM(bot_count) FROM active_bots")[0] or 0
    
    text = (f"📊 **Global Statistics**\n\n"
            f"👥 Total Users: {total_users}\n"
            f"💸 Total Revenue: ₹{total_rev:.2f}\n"
            f"🤖 Total Active Hosted Bots: {active_bots}")
            
    builder = InlineKeyboardBuilder()
    builder.button(text="🔙 Back to Admin", callback_data="admin_panel")
    await safe_menu_edit(callback, text, builder.as_markup())

@dp.callback_query(F.data == "admin_payments")
async def admin_payments(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID: return
    records = get_db_value("SELECT user_id, amount, timestamp FROM purchases ORDER BY timestamp DESC LIMIT 10", fetchone=False)
    
    text = "💸 **Last 10 Payments**\n\n"
    if not records:
        text += "No payments recorded yet."
    else:
        for r in records:
            dt = datetime.fromtimestamp(r[2]).strftime('%m-%d %H:%M')
            text += f"UID `{r[0]}`: ₹{r[1]} ({dt})\n"
            
    builder = InlineKeyboardBuilder()
    builder.button(text="🔙 Back to Admin", callback_data="admin_panel")
    await safe_menu_edit(callback, text, builder.as_markup())

@dp.callback_query(F.data == "admin_set_video")
async def ask_for_video(callback: CallbackQuery, state: FSMContext):
    if callback.from_user.id != ADMIN_ID: return
    
    builder = InlineKeyboardBuilder()
    builder.button(text="❌ Cancel", callback_data="admin_panel")
    
    await safe_menu_edit(callback, "🎬 **Upload Video**\n\nPlease send the video (or GIF) you want to display on the main menu now.", builder.as_markup())
    await state.set_state(AdminStates.waiting_for_video)

@dp.message(AdminStates.waiting_for_video, F.video | F.animation)
async def receive_menu_video(message: Message, state: FSMContext):
    if message.from_user.id != ADMIN_ID: return
    
    # Get the file_id of the uploaded video
    file_id = message.video.file_id if message.video else message.animation.file_id
    set_setting("menu_video", file_id)
    
    await state.clear()
    
    builder = InlineKeyboardBuilder()
    builder.button(text="🔙 Back to Admin", callback_data="admin_panel")
    await message.answer("✅ Main menu video successfully updated!", reply_markup=builder.as_markup())

@dp.callback_query(F.data == "admin_remove_video")
async def remove_video(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID: return
    execute_db("DELETE FROM settings WHERE key = 'menu_video'")
    await callback.answer("Video removed from main menu.", show_alert=True)
    await admin_panel_callback(callback)

# --- BACKGROUND EXPIRATION LOOP ---
async def check_expirations():
    while True:
        current_time = time.time()
        expired = get_db_value("SELECT user_id, bot_count FROM active_bots WHERE expires_at < ?", (current_time,), fetchone=False)
        
        if expired:
            execute_db("DELETE FROM active_bots WHERE expires_at < ?", (current_time,))
            for row in expired:
                try:
                    await bot.send_message(row[0], f"⚠️ Your 24-hour hosting for {row[1]} bots has expired. Access revoked.")
                except Exception:
                    pass
                    
        await asyncio.sleep(60)

async def main():
    init_db()
    asyncio.create_task(check_expirations())
    print("Bot is running...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
