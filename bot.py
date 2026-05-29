import asyncio
import sqlite3
import time
from datetime import datetime
from aiogram import Bot, Dispatcher, F
from aiogram.types import (
    Message, CallbackQuery, LabeledPrice, PreCheckoutQuery,
    InlineKeyboardMarkup, InlineKeyboardButton
)
from aiogram.filters import CommandStart, Command
from aiogram.utils.keyboard import InlineKeyboardBuilder

# --- CONFIGURATION ---
BOT_TOKEN = "YOUR_BOT_TOKEN_HERE"
PROVIDER_TOKEN = "YOUR_RAZORPAY_TOKEN_HERE" # From BotFather
ADMIN_ID = 123456789 # Replace with your Telegram User ID

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# --- DATABASE SETUP ---
def init_db():
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (user_id INTEGER PRIMARY KEY, wallet REAL DEFAULT 0, is_premium INTEGER DEFAULT 0)''')
    c.execute('''CREATE TABLE IF NOT EXISTS active_bots
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, bot_count INTEGER, expires_at REAL)''')
    c.execute('''CREATE TABLE IF NOT EXISTS purchases
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount REAL, timestamp REAL)''')
    conn.commit()
    conn.close()

def get_user(user_id):
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    c.execute("SELECT wallet, is_premium FROM users WHERE user_id = ?", (user_id,))
    res = c.fetchone()
    conn.close()
    return res

def add_user(user_id):
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    c.execute("INSERT OR IGNORE INTO users (user_id) VALUES (?)", (user_id,))
    conn.commit()
    conn.close()

# --- REUSABLE MAIN MENU BUILDER ---
def get_main_menu():
    builder = InlineKeyboardBuilder()
    builder.button(text="👤 Profile", callback_data="profile")
    builder.button(text="💰 Wallet", callback_data="wallet")
    builder.button(text="🛒 Buy Hosted Bots", callback_data="buy_bots")
    builder.button(text="📜 Purchase History", callback_data="history")
    builder.button(text="📞 Contact Admin", url="https://t.me/your_admin_handle")
    # Adjust layout: 2 buttons on first row, then 1 per row for the rest
    builder.adjust(2, 1, 1, 1)
    return builder.as_markup()

def get_back_button():
    builder = InlineKeyboardBuilder()
    builder.button(text="🔙 Back to Menu", callback_data="main_menu")
    return builder.as_markup()

# --- CORE NAVIGATION ---
@dp.message(CommandStart())
async def start_cmd(message: Message):
    add_user(message.from_user.id)
    await message.answer("🤖 **Welcome to the Premium Bot Hosting Service!**\n\nSelect an option below to manage your account.", 
                         reply_markup=get_main_menu(), parse_mode="Markdown")

@dp.callback_query(F.data == "main_menu")
async def back_to_main(callback: CallbackQuery):
    await callback.message.edit_text("🤖 **Main Menu**\n\nSelect an option below to manage your account.", 
                                     reply_markup=get_main_menu(), parse_mode="Markdown")

# --- DASHBOARD MENUS ---
@dp.callback_query(F.data == "profile")
async def show_profile(callback: CallbackQuery):
    user = get_user(callback.from_user.id)
    
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    c.execute("SELECT SUM(bot_count) FROM active_bots WHERE user_id = ?", (callback.from_user.id,))
    active = c.fetchone()[0] or 0
    conn.close()
    
    text = (f"👤 **Your Profile**\n\n"
            f"🆔 User ID: `{callback.from_user.id}`\n"
            f"👑 Status: {'Premium User ⭐' if user[1] else 'Standard User'}\n"
            f"🤖 Active Hosted Bots: **{active}**\n")
    
    await callback.message.edit_text(text, reply_markup=get_back_button(), parse_mode="Markdown")

@dp.callback_query(F.data == "wallet")
async def show_wallet(callback: CallbackQuery):
    user = get_user(callback.from_user.id)
    
    text = (f"💰 **Wallet Dashboard**\n\n"
            f"**Current Balance:** ₹{user[0]:.2f}\n\n"
            f"*(Note: Currently, funds are deducted directly at checkout via UPI. Manual wallet top-ups will be added in a future update.)*")
    
    await callback.message.edit_text(text, reply_markup=get_back_button(), parse_mode="Markdown")

@dp.callback_query(F.data == "history")
async def show_history(callback: CallbackQuery):
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    c.execute("SELECT amount, timestamp FROM purchases WHERE user_id = ? ORDER BY timestamp DESC LIMIT 5", (callback.from_user.id,))
    records = c.fetchall()
    conn.close()
    
    if not records:
        text = "📜 **Purchase History**\n\nYou have not made any purchases yet."
    else:
        text = "📜 **Recent Purchases (Last 5)**\n\n"
        for idx, row in enumerate(records, 1):
            amount = row[0]
            date_str = datetime.fromtimestamp(row[1]).strftime('%Y-%m-%d %H:%M')
            text += f"{idx}. ₹{amount:.2f} on {date_str}\n"
            
    await callback.message.edit_text(text, reply_markup=get_back_button(), parse_mode="Markdown")

# --- PURCHASING & AUTOMATED ACCESS ---
@dp.callback_query(F.data == "buy_bots")
async def buy_bots_menu(callback: CallbackQuery):
    builder = InlineKeyboardBuilder()
    builder.button(text="15 Bots (24 Hours) - ₹30", callback_data="invoice_15_24")
    builder.button(text="🔙 Back", callback_data="main_menu")
    builder.adjust(1)
    
    await callback.message.edit_text("🛒 **Store**\n\nSelect a hosting package. Access will be automatically revoked after the duration expires.", 
                                     reply_markup=builder.as_markup(), parse_mode="Markdown")

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
    await callback.answer()

@dp.pre_checkout_query()
async def pre_checkout_handler(pre_checkout: PreCheckoutQuery):
    await bot.answer_pre_checkout_query(pre_checkout.id, ok=True)

@dp.message(F.successful_payment)
async def successful_payment_handler(message: Message):
    user_id = message.from_user.id
    amount = message.successful_payment.total_amount / 100 
    
    expires_at = time.time() + (24 * 3600)
    
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    c.execute("INSERT INTO active_bots (user_id, bot_count, expires_at) VALUES (?, ?, ?)", (user_id, 15, expires_at))
    c.execute("UPDATE users SET is_premium = 1 WHERE user_id = ?", (user_id,))
    c.execute("INSERT INTO purchases (user_id, amount, timestamp) VALUES (?, ?, ?)", (user_id, amount, time.time()))
    conn.commit()
    conn.close()
    
    await message.answer("✅ **Payment successful!**\n\nYou have been granted premium access for 15 bots for the next 24 hours. Check your Profile to see your active bots.", parse_mode="Markdown")

# --- ADMIN DASHBOARD ---
@dp.message(Command("admin"))
async def admin_panel(message: Message):
    if message.from_user.id != ADMIN_ID:
        return
        
    conn = sqlite3.connect("hosting.db")
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM users")
    total_users = c.fetchone()[0]
    c.execute("SELECT SUM(amount) FROM purchases")
    total_rev = c.fetchone()[0] or 0.0
    conn.close()
    
    text = (f"🛠 **Admin Dashboard**\n\n"
            f"👥 Total Users: {total_users}\n"
            f"💸 Total Revenue: ₹{total_rev}\n")
            
    await message.answer(text, parse_mode="Markdown")

# --- BACKGROUND EXPIRATION LOOP ---
async def check_expirations():
    while True:
        conn = sqlite3.connect("hosting.db")
        c = conn.cursor()
        current_time = time.time()
        
        c.execute("SELECT user_id, bot_count FROM active_bots WHERE expires_at < ?", (current_time,))
        expired = c.fetchall()
        
        if expired:
            c.execute("DELETE FROM active_bots WHERE expires_at < ?", (current_time,))
            conn.commit()
            
            for row in expired:
                try:
                    await bot.send_message(row[0], f"⚠️ Your 24-hour hosting for {row[1]} bots has expired. Access has been automatically revoked.")
                except Exception:
                    pass
                    
        conn.close()
        await asyncio.sleep(60)

async def main():
    init_db()
    asyncio.create_task(check_expirations())
    print("Bot is running...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
