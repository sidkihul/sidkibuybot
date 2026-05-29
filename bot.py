import asyncio
import sqlite3
import time
import os
from datetime import datetime
from aiogram import Bot, Dispatcher, F
from aiogram.types import (
    Message, CallbackQuery, LabeledPrice, PreCheckoutQuery, WebAppInfo
)
from aiogram.filters import CommandStart, Command, CommandObject
from aiogram.utils.keyboard import InlineKeyboardBuilder
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

# --- CONFIGURATION ---
BOT_TOKEN = "8650706516:AAHw04CwFcdy5uvQjeaasHAkr1QL1yTl3ac"
PROVIDER_TOKEN = "YOUR_RAZORPAY_TOKEN_HERE" # From BotFather
ADMIN_ID = 123456789 # Replace with your Telegram User ID
WEB_APP_URL = "sidkibuybot-production.up.railway.app/" # Update to your GitHub Pages link

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# --- DATABASE SETUP (BULLETPROOFED) ---
DB_PATH = "data/hosting.db"

def init_db():
    # Automatically creates the folder if it doesn't exist, preventing Railway crashes
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY, wallet REAL DEFAULT 0, is_premium INTEGER DEFAULT 0, referrer_id INTEGER)''')
    c.execute('''CREATE TABLE IF NOT EXISTS active_bots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, bot_count INTEGER, expires_at REAL)''')
    c.execute('''CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount REAL, timestamp REAL)''')
    c.execute('''CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)''')
    conn.commit()
    conn.close()

def get_db_value(query, params=(), fetchone=True):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(query, params)
    res = c.fetchone() if fetchone else c.fetchall()
    conn.close()
    return res

def execute_db(query, params=()):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(query, params)
    conn.commit()
    conn.close()

def get_setting(key):
    res = get_db_value("SELECT value FROM settings WHERE key = ?", (key,))
    return res[0] if res else None

def set_setting(key, value):
    execute_db("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))

# --- FSM STATES ---
class AdminStates(StatesGroup):
    waiting_for_video = State()
    waiting_for_broadcast = State()
    waiting_for_user_id_balance = State()
    waiting_for_amount_balance = State()

# --- REUSABLE MENUS & NAVIGATION ---
def get_main_menu(user_id):
    builder = InlineKeyboardBuilder()
    builder.button(text="✨ Open Glass Dashboard ✨", web_app=WebAppInfo(url=WEB_APP_URL))
    builder.button(text="🔥 Profile", callback_data="profile")
    builder.button(text="🐉 Dragon Wallet", callback_data="wallet")
    builder.button(text="⚡ Buy Hosted Bots", callback_data="buy_bots")
    builder.button(text="🔗 Earn Free Balance", callback_data="referral")
    builder.button(text="📜 History", callback_data="history")
    builder.button(text="📞 Support", url="https://t.me/your_admin_handle")
    
    if user_id == ADMIN_ID:
        builder.button(text="🛠️ Admin Dashboard ⚙️", callback_data="admin_panel")
        builder.adjust(1, 2, 2, 2, 1) 
    else:
        builder.adjust(1, 2, 2, 2)
        
    return builder.as_markup()

def get_back_button():
    builder = InlineKeyboardBuilder()
    builder.button(text="🔙 Return to Lair", callback_data="main_menu")
    return builder.as_markup()

async def safe_menu_edit(callback: CallbackQuery, text: str, reply_markup):
    try:
        if callback.message.video or callback.message.animation:
            await callback.message.delete()
            await callback.message.answer(text, reply_markup=reply_markup, parse_mode="Markdown")
        else:
            await callback.message.edit_text(text, reply_markup=reply_markup, parse_mode="Markdown")
    except Exception:
        await callback.message.delete()
        await callback.message.answer(text, reply_markup=reply_markup, parse_mode="Markdown")

# --- CORE NAVIGATION (WITH REFERRALS) ---
@dp.message(CommandStart())
async def start_cmd(message: Message, command: CommandObject, state: FSMContext):
    await state.clear()
    user_id = message.from_user.id
    
    existing_user = get_db_value("SELECT user_id FROM users WHERE user_id = ?", (user_id,))
    
    if not existing_user:
        referrer_id = None
        if command.args and command.args.startswith("ref_"):
            try:
                referrer_id = int(command.args.split("_")[1])
                if referrer_id != user_id:
                    execute_db("UPDATE users SET wallet = wallet + 10 WHERE user_id = ?", (referrer_id,))
                    try:
                        await bot.send_message(referrer_id, "🎉 **New Referral!**\nSomeone joined using your link. ₹10 has been added to your Dragon Wallet!", parse_mode="Markdown")
                    except Exception: pass
            except ValueError:
                pass
        execute_db("INSERT INTO users (user_id, referrer_id) VALUES (?, ?)", (user_id, referrer_id))
    
    caption = "🐉 **Welcome to the Dragon Hosting Lair!**\n\nClick the ✨ **Open Glass Dashboard** ✨ button below to launch the premium interface, or use the quick menu."
    video_id = get_setting("menu_video")
    
    if video_id:
        await message.answer_video(video=video_id, caption=caption, reply_markup=get_main_menu(user_id), parse_mode="Markdown")
    else:
        await message.answer(caption, reply_markup=get_main_menu(user_id), parse_mode="Markdown")

@dp.callback_query(F.data == "main_menu")
async def back_to_main(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    caption = "🐉 **Main Menu**\n\nClick the ✨ **Open Glass Dashboard** ✨ button below to launch the premium interface, or use the quick menu."
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
            f"👑 Status: {'Dragon Lord (Premium) 🐉' if user[1] else 'Standard User'}\n"
            f"🤖 Active Hosted Bots: **{active_count}**\n")
    await safe_menu_edit(callback, text, get_back_button())

@dp.callback_query(F.data == "wallet")
async def show_wallet(callback: CallbackQuery):
    user = get_db_value("SELECT wallet FROM users WHERE user_id = ?", (callback.from_user.id,))
    text = (f"💰 **Dragon Wallet**\n\n"
            f"**Current Balance:** ₹{user[0]:.2f}\n\n"
            f"*(Earn free balance using your referral link!)*")
    await safe_menu_edit(callback, text, get_back_button())

@dp.callback_query(F.data == "referral")
async def show_referral(callback: CallbackQuery):
    bot_info = await bot.get_me()
    ref_link = f"https://t.me/{bot_info.username}?start=ref_{callback.from_user.id}"
    
    refs = get_db_value("SELECT COUNT(*) FROM users WHERE referrer_id = ?", (callback.from_user.id,))
    ref_count = refs[0] if refs else 0
    
    text = (f"🔗 **Referral Program**\n\n"
            f"Invite friends to earn free wallet balance! You get **₹10** for every user who starts the bot using your link.\n\n"
            f"👥 **Total Referrals:** {ref_count}\n\n"
            f"👇 **Your Unique Link:**\n`{ref_link}`")
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
    builder.button(text="🔥 15 Bots (24 Hours) - ₹30 🔥", callback_data="invoice_15_24")
    builder.button(text="🔙 Back", callback_data="main_menu")
    builder.adjust(1)
    text = "🛒 **Store**\n\nSelect a hosting package. Access is automatically revoked when time expires."
    await safe_menu_edit(callback, text, builder.as_markup())

@dp.callback_query(F.data == "invoice_15_24")
async def send_hosting_invoice(callback: CallbackQuery):
    price = LabeledPrice(label="15 Hosted Bots (24h)", amount=30 * 100)
    await bot.send_invoice(
        chat_id=callback.from_user.id,
        title="Dragon Hosting: 15 Bots",
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
    
    await message.answer("🐉 **Payment successful!**\n\nYou have been granted premium access for 15 bots for the next 24 hours.", parse_mode="Markdown")

# --- FULL ADMIN DASHBOARD ---
@dp.callback_query(F.data == "admin_panel")
async def admin_panel_callback(callback: CallbackQuery, state: FSMContext):
    if callback.from_user.id != ADMIN_ID:
        return await callback.answer("Unauthorized", show_alert=True)
    
    await state.clear()
    builder = InlineKeyboardBuilder()
    builder.button(text="📊 User Stats", callback_data="admin_stats")
    builder.button(text="💸 Payment Logs", callback_data="admin_payments")
    builder.button(text="📢 Broadcast", callback_data="admin_broadcast")
    builder.button(text="💰 Add Balance", callback_data="admin_add_balance")
    builder.button(text="🎬 Set Menu Video", callback_data="admin_set_video")
    builder.button(text="🗑️ Remove Video", callback_data="admin_remove_video")
    builder.button(text="🔙 Exit Admin", callback_data="main_menu")
    builder.adjust(2, 2, 2, 1)
    
    text = "🛠 **Admin Command Center**\n\nManage the bot, view statistics, and update the UI."
    await safe_menu_edit(callback, text, builder.as_markup())

# Admin: Broadcast
@dp.callback_query(F.data == "admin_broadcast")
async def admin_broadcast(callback: CallbackQuery, state: FSMContext):
    if callback.from_user.id != ADMIN_ID: return
    builder = InlineKeyboardBuilder()
    builder.button(text="❌ Cancel", callback_data="admin_panel")
    await safe_menu_edit(callback, "📢 **Broadcast Message**\n\nSend the message (text, image, or video) you want to broadcast to ALL users.", builder.as_markup())
    await state.set_state(AdminStates.waiting_for_broadcast)

@dp.message(AdminStates.waiting_for_broadcast)
async def process_broadcast(message: Message, state: FSMContext):
    if message.from_user.id != ADMIN_ID: return
    users = get_db_value("SELECT user_id FROM users", fetchone=False)
    
    await message.answer(f"⏳ Broadcasting to {len(users)} users...")
    success, failed = 0, 0
    
    for user in users:
        try:
            await message.send_copy(chat_id=user[0])
            success += 1
            await asyncio.sleep(0.05) 
        except Exception:
            failed += 1
            
    await state.clear()
    builder = InlineKeyboardBuilder()
    builder.button(text="🔙 Back to Admin", callback_data="admin_panel")
    await message.answer(f"✅ **Broadcast Complete**\nSuccess: {success}\nFailed (Blocked Bot): {failed}", reply_markup=builder.as_markup())

# Admin: Add Balance
@dp.callback_query(F.data == "admin_add_balance")
async def admin_add_bal_start(callback: CallbackQuery, state: FSMContext):
    if callback.from_user.id != ADMIN_ID: return
    builder = InlineKeyboardBuilder()
    builder.button(text="❌ Cancel", callback_data="admin_panel")
    await safe_menu_edit(callback, "💰 **Add Wallet Balance**\n\nPlease enter the **User ID** of the person:", builder.as_markup())
    await state.set_state(AdminStates.waiting_for_user_id_balance)

@dp.message(AdminStates.waiting_for_user_id_balance)
async def admin_add_bal_id(message: Message, state: FSMContext):
    if message.from_user.id != ADMIN_ID: return
    try:
        user_id = int(message.text)
        await state.update_data(target_user=user_id)
        
        builder = InlineKeyboardBuilder()
        builder.button(text="❌ Cancel", callback_data="admin_panel")
        await message.answer("Enter the **amount (₹)** to add to their wallet:", reply_markup=builder.as_markup())
        await state.set_state(AdminStates.waiting_for_amount_balance)
    except ValueError:
        await message.answer("⚠️ Invalid ID. Please enter a valid number.")

@dp.message(AdminStates.waiting_for_amount_balance)
async def admin_add_bal_amount(message: Message, state: FSMContext):
    if message.from_user.id != ADMIN_ID: return
    try:
        amount = float(message.text)
        data = await state.get_data()
        target_user = data['target_user']
        
        execute_db("UPDATE users SET wallet = wallet + ? WHERE user_id = ?", (amount, target_user))
        
        builder = InlineKeyboardBuilder()
        builder.button(text="🔙 Back to Admin", callback_data="admin_panel")
        await message.answer(f"✅ Successfully added ₹{amount} to User ID `{target_user}`.", reply_markup=builder.as_markup())
        
        try:
            await bot.send_message(target_user, f"💰 **Admin added funds to your account!**\n₹{amount} has been added to your Dragon Wallet.")
        except Exception: pass
        
        await state.clear()
    except ValueError:
        await message.answer("⚠️ Invalid amount. Please enter a number.")

# Admin: Media & Stats
@dp.callback_query(F.data == "admin_set_video")
async def ask_for_video(callback: CallbackQuery, state: FSMContext):
    if callback.from_user.id != ADMIN_ID: return
    builder = InlineKeyboardBuilder()
    builder.button(text="❌ Cancel", callback_data="admin_panel")
    await safe_menu_edit(callback, "🎬 **Upload Dragon Animation**\n\nPlease send the looping video or GIF to display on the main menu.", builder.as_markup())
    await state.set_state(AdminStates.waiting_for_video)

@dp.message(AdminStates.waiting_for_video, F.video | F.animation)
async def receive_menu_video(message: Message, state: FSMContext):
    if message.from_user.id != ADMIN_ID: return
    file_id = message.video.file_id if message.video else message.animation.file_id
    set_setting("menu_video", file_id)
    await state.clear()
    builder = InlineKeyboardBuilder()
    builder.button(text="🔙 Back to Admin", callback_data="admin_panel")
    await message.answer("✅ Dragon aesthetic updated successfully!", reply_markup=builder.as_markup())

@dp.callback_query(F.data == "admin_remove_video")
async def remove_video(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID: return
    execute_db("DELETE FROM settings WHERE key = 'menu_video'")
    await callback.answer("Video removed.", show_alert=True)
    await admin_panel_callback(callback, FSMContext(storage=dp.storage, key=callback.message.chat.id))

@dp.callback_query(F.data == "admin_stats")
async def admin_stats(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID: return
    total_users = get_db_value("SELECT COUNT(*) FROM users")[0]
    total_rev = get_db_value("SELECT SUM(amount) FROM purchases")[0] or 0.0
    active_bots = get_db_value("SELECT SUM(bot_count) FROM active_bots")[0] or 0
    text = (f"📊 **Global Statistics**\n\n"
            f"👥 Total Users: {total_users}\n"
            f"💸 Total Revenue: ₹{total_rev:.2f}\n"
            f"🤖 Total Active Bots: {active_bots}")
    builder = InlineKeyboardBuilder()
    builder.button(text="🔙 Back to Admin", callback_data="admin_panel")
    await safe_menu_edit(callback, text, builder.as_markup())

@dp.callback_query(F.data == "admin_payments")
async def admin_payments(callback: CallbackQuery):
    if callback.from_user.id != ADMIN_ID: return
    records = get_db_value("SELECT user_id, amount, timestamp FROM purchases ORDER BY timestamp DESC LIMIT 10", fetchone=False)
    text = "💸 **Last 10 Payments**\n\n"
    if not records:
        text += "No payments recorded."
    else:
        for r in records:
            dt = datetime.fromtimestamp(r[2]).strftime('%m-%d %H:%M')
            text += f"UID `{r[0]}`: ₹{r[1]} ({dt})\n"
    builder = InlineKeyboardBuilder()
    builder.button(text="🔙 Back to Admin", callback_data="admin_panel")
    await safe_menu_edit(callback, text, builder.as_markup())

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
    print("Bot is alive and listening...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
